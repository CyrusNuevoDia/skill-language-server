import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { type } from "arktype"
import { groupBy, mapValues, partition } from "es-toolkit"
import {
  CompletionItemKind,
  type Connection,
  type Diagnostic,
  DidChangeWatchedFilesNotification,
  type DocumentLink,
  FileChangeType,
  type InitializeParams,
  type Location,
  LSPErrorCodes,
  ResourceOperationKind,
  ResponseError,
  SemanticTokensBuilder,
  type TextDocumentEdit,
  TextDocumentSyncKind,
  TextDocuments,
  type WorkspaceEdit,
} from "vscode-languageserver"
import { TextDocument } from "vscode-languageserver-textdocument"
import { BAD_PREV, fullRange } from "./parse"
import { pathOf, rangeIn, uriOf } from "./utils"
import { type Skill, SkillName, Workspace } from "./workspace"

const TYPED_PREFIX = /^[a-z0-9_:-]*$/

export function startServer(connection: Connection): void {
  const documents = new TextDocuments(TextDocument)
  let ws: Workspace | null = null
  let supportsRenameFile = false
  let supportsWatchedFiles = false

  // vscode-jsonrpc dispatches the next message without awaiting an async
  // notification handler, so every index mutation is serialized through this
  // one promise chain and every request handler awaits its tail — a request
  // can never observe a half-applied scan/reindex, and a request round-trip
  // (the test harness's settle()) still proves earlier publishes landed.
  let pending: Promise<void> = Promise.resolve()
  function enqueue(task: () => Promise<void> | void): void {
    pending = pending
      .then(task)
      .catch((err) => connection.console.error(`indexing failed: ${err}`))
  }

  // Neovim materializes a phantom buffer for every URI that ever receives a
  // publish, so empty arrays go out only to clear a previous non-empty set.
  const published = new Set<string>()
  function publish(uri: string, diagnostics: Diagnostic[]): void {
    if (diagnostics.length > 0) {
      published.add(uri)
      connection.sendDiagnostics({ diagnostics, uri })
    } else if (published.delete(uri)) {
      connection.sendDiagnostics({ diagnostics: [], uri })
    }
  }

  connection.onInitialize((params: InitializeParams) => {
    const rootUri = params.workspaceFolders?.[0]?.uri ?? params.rootUri
    // Non-file roots (virtual filesystems) get the same degraded mode as no root.
    if (rootUri && pathOf(rootUri)) {
      ws = new Workspace(rootUri)
    }

    // Neovim declares resourceOperations without documentChanges — either flag
    // is enough to emit a RenameFile.
    const wsEdit = params.capabilities.workspace?.workspaceEdit
    supportsRenameFile =
      wsEdit?.documentChanges === true ||
      (wsEdit?.resourceOperations ?? []).includes(ResourceOperationKind.Rename)
    supportsWatchedFiles =
      params.capabilities.workspace?.didChangeWatchedFiles
        ?.dynamicRegistration === true

    return {
      capabilities: {
        completionProvider: { triggerCharacters: ["/", "$"] },
        definitionProvider: true,
        documentLinkProvider: {},
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        semanticTokensProvider: {
          full: true,
          legend: { tokenModifiers: [], tokenTypes: ["function"] },
        },
        textDocumentSync: TextDocumentSyncKind.Incremental,
        workspace: {
          fileOperations: {
            willRename: {
              filters: [
                { pattern: { glob: "**/skills/*", matches: "folder" } },
              ],
            },
          },
        },
      },
    }
  })

  connection.onInitialized(() => {
    const w = ws
    if (!w) {
      return
    }
    if (supportsWatchedFiles) {
      connection.client
        .register(DidChangeWatchedFilesNotification.type, {
          watchers: [
            { globPattern: "**/*.md" },
            { globPattern: "**/.skillignore" },
            // Folder deletes arrive as one event for the folder itself,
            // which **/*.md never matches.
            { globPattern: "**/skills/*" },
          ],
        })
        .catch(() => {
          // Client declined; didOpen-based reindexing still works.
        })
    }
    enqueue(async () => {
      await w.scan()
      publishAll()
    })
  })

  connection.onDidChangeWatchedFiles(({ changes }) => {
    if (!ws) {
      return
    }
    const [ignoreChanges, fileChanges] = partition(changes, (c) =>
      isSkillignore(c.uri)
    )
    enqueue(async () => {
      for (const change of fileChanges) {
        // biome-ignore lint/performance/noAwaitInLoops: changes must apply in arrival order
        await applyWatchedChange(change.type, change.uri)
      }
      if (ignoreChanges.length > 0) {
        await rescanPreservingOpenBuffers()
      }
      // Duplicate/mismatch diagnostics depend on global state; republish all.
      publishAll()
    })
  })

  function isSkillignore(uri: string): boolean {
    const path = pathOf(uri)
    return path !== null && basename(path) === ".skillignore"
  }

  async function applyWatchedChange(
    change: FileChangeType,
    uri: string
  ): Promise<void> {
    if (!ws) {
      return
    }
    // An open buffer is authoritative over disk until the editor closes it.
    if (documents.get(uri)) {
      return
    }
    const path = pathOf(uri)
    if (!path) {
      return
    }
    if (change === FileChangeType.Deleted) {
      // A recursive folder delete arrives as ONE event for the folder itself;
      // evict everything underneath, but open buffers stay authoritative.
      for (const removed of ws.removeUnder(path)) {
        const doc = documents.get(removed.uri)
        const removedPath = pathOf(removed.uri)
        if (doc && removedPath) {
          ws.indexFile(removedPath, doc.getText())
        } else {
          publish(removed.uri, [])
        }
      }
    } else if (ws.inScope(path) && !(await ws.reindexPath(path))) {
      // Unreadable now (replaced by a directory, permissions): clear its
      // published diagnostics along with the index entry.
      publish(uri, [])
    }
  }

  async function rescanPreservingOpenBuffers(): Promise<void> {
    if (!ws) {
      return
    }
    const before = new Set(ws.files.keys())
    await ws.scan()
    // scan() reads disk; restore index entries for dirty open buffers.
    for (const doc of documents.all()) {
      const path = pathOf(doc.uri)
      if (path && ws.inScope(path)) {
        ws.indexFile(path, doc.getText())
      }
    }
    // Files the rescan dropped (newly ignored) keep stale diagnostics on
    // screen unless we explicitly clear them.
    for (const uri of before) {
      if (!ws.files.has(uri)) {
        publish(uri, [])
      }
    }
  }

  function publishAll(): void {
    if (!ws) {
      return
    }
    for (const [uri, diagnostics] of ws.diagnosticsByURI()) {
      publish(uri, diagnostics)
    }
  }

  documents.onDidChangeContent(({ document }) => {
    const w = ws
    if (!w) {
      return
    }
    enqueue(() => {
      const path = pathOf(document.uri)
      if (!(path && w.inScope(path))) {
        return
      }
      const entry = w.indexFile(path, document.getText())
      publish(entry.uri, w.diagnosticsFor(entry))
    })
  })

  documents.onDidClose(({ document }) => {
    const w = ws
    if (!w) {
      return
    }
    enqueue(async () => {
      const path = pathOf(document.uri)
      if (!(path && w.inScope(path))) {
        return
      }
      // Disk becomes authoritative again: discard whatever the closed buffer
      // held (an unsaved close leaves no watcher event to re-sync from).
      if (!(await w.reindexPath(path))) {
        publish(document.uri, [])
      }
      publishAll()
    })
  })

  connection.onDefinition(async ({ textDocument, position }) => {
    await pending
    if (!ws) {
      return null
    }
    const token = ws.tokenAt(textDocument.uri, position)
    const skill = token && ws.skillOf(token.name)
    return skill ? ws.definitionOf(skill) : null
  })

  connection.languages.semanticTokens.on(async ({ textDocument }) => {
    await pending
    if (!ws) {
      return { data: [] }
    }
    const entry = ws.files.get(textDocument.uri)
    if (!entry) {
      return { data: [] }
    }
    const builder = new SemanticTokensBuilder()
    for (const token of entry.tokens) {
      if (ws.skillOf(token.name)) {
        const { start, end } = fullRange(token)
        builder.push(
          start.line,
          start.character,
          end.character - start.character,
          0,
          0
        )
      }
    }
    return builder.build()
  })

  connection.onDocumentLinks(async ({ textDocument }) => {
    await pending
    if (!ws) {
      return []
    }
    const entry = ws.files.get(textDocument.uri)
    if (!entry) {
      return []
    }
    const links: DocumentLink[] = []
    for (const token of entry.tokens) {
      const skill = ws.skillOf(token.name)
      if (skill) {
        links.push({
          range: fullRange(token),
          target: uriOf(skill.skillFilePath),
        })
      }
    }
    return links
  })

  connection.onReferences(async ({ textDocument, position, context }) => {
    await pending
    if (!ws) {
      return null
    }
    const skill = ws.skillAt(textDocument.uri, position)
    if (!skill) {
      return null
    }
    const refs = ws.referencesTo(skill.name)
    // Only include a declaration that actually exists — no phantom 0:0 entry
    // for a SKILL.md missing its name: field.
    if (
      context.includeDeclaration &&
      ws.entryOf(skill)?.frontmatter?.nameRange
    ) {
      refs.push(ws.definitionOf(skill))
    }
    return refs
  })

  connection.onPrepareRename(async ({ textDocument, position }) => {
    await pending
    if (!ws) {
      return null
    }
    const token = ws.tokenAt(textDocument.uri, position)
    if (token && ws.skillOf(token.name)) {
      return { placeholder: token.name, range: token.nameRange }
    }
    const decl = ws.declAt(textDocument.uri, position)
    return decl ? { placeholder: decl.name, range: decl.range } : null
  })

  connection.onRenameRequest(async ({ textDocument, position, newName }) => {
    await pending
    if (!ws) {
      return null
    }
    const skill = ws.skillAt(textDocument.uri, position)
    if (!skill) {
      return null
    }

    const validated = SkillName(newName)
    if (validated instanceof type.errors) {
      // The params are well-formed JSON-RPC; the VALUE fails domain rules.
      throw new ResponseError(
        LSPErrorCodes.RequestFailed,
        `Invalid skill name "${newName}": ${validated.summary}`
      )
    }
    if (newName === skill.name) {
      return null // no-op; a self-RenameFile would fail client-side
    }
    if (ws.skills.has(newName)) {
      throw new ResponseError(
        LSPErrorCodes.RequestFailed,
        `A skill named "${newName}" already exists.`
      )
    }

    if (!supportsRenameFile) {
      // A client declaring neither documentChanges nor resourceOperations
      // only supports the plain changes map; the folder is renamed manually.
      return {
        changes: mapValues(
          groupBy(renameLocations(ws, skill), (loc) => loc.uri),
          (locs) => locs.map((loc) => ({ newText: newName, range: loc.range }))
        ),
      } satisfies WorkspaceEdit
    }
    return {
      documentChanges: [
        ...renameTextEdits(ws, skill, newName),
        {
          kind: "rename" as const,
          newUri: uriOf(join(dirname(skill.folderPath), newName)),
          oldUri: uriOf(skill.folderPath),
        },
      ],
    } satisfies WorkspaceEdit
  })

  connection.workspace.onWillRenameFiles(async ({ files }) => {
    await pending
    if (!ws) {
      return null
    }
    const edits: TextDocumentEdit[] = []
    for (const { oldUri, newUri } of files) {
      const oldPath = fileURLToPath(oldUri)
      const skill = [...ws.skills.values()]
        .flat()
        .find((s) => s.folderPath === oldPath)
      if (!skill) {
        continue
      }
      const newName = basename(fileURLToPath(newUri))
      if (!SkillName.allows(newName)) {
        continue
      }
      edits.push(...renameTextEdits(ws, skill, newName))
    }
    return edits.length > 0 ? { documentChanges: edits } : null
  })

  connection.onCompletion(async ({ textDocument, position }) => {
    await pending
    if (!ws) {
      return null
    }
    const doc = documents.get(textDocument.uri)
    const path = pathOf(textDocument.uri)
    if (!(doc && path && ws.inScope(path))) {
      return null
    }
    if (ws.files.get(textDocument.uri)?.fenced.has(position.line)) {
      return null
    }
    const prefix = doc.getText({
      end: position,
      start: { character: 0, line: position.line },
    })
    const sigilAt = Math.max(prefix.lastIndexOf("/"), prefix.lastIndexOf("$"))
    if (sigilAt === -1) {
      return null
    }
    // Same boundary rule as the reference parser: a sigil preceded by a
    // word/path char is a file path or shell var, not a skill reference.
    const before = sigilAt > 0 ? prefix[sigilAt - 1] : ""
    if (before && BAD_PREV.test(before)) {
      return null
    }
    const typed = prefix.slice(sigilAt + 1)
    if (!TYPED_PREFIX.test(typed)) {
      return null
    }

    // Explicit textEdit: `-` and `:` are word delimiters in markdown, so
    // client-side word replacement would mangle multi-segment names
    // (accepting "session-report" over the typed "session-rep" must not
    // yield "session-session-report").
    const editRange = rangeIn(position.line, sigilAt + 1, position.character)
    return [...ws.skills].map(([name, entries]) => {
      const description = ws?.entryOf(entries[0])?.frontmatter?.description
      return {
        ...(description && {
          documentation: { kind: "markdown" as const, value: description },
        }),
        filterText: name,
        kind: CompletionItemKind.Reference,
        label: name,
        textEdit: { newText: name, range: editRange },
      }
    })
  })

  documents.listen(connection)
  connection.listen()
}

/** Every range to rewrite when renaming a skill: references plus the frontmatter name. */
function renameLocations(ws: Workspace, skill: Skill): Location[] {
  const targets = ws.referencesTo(skill.name)
  // Only edit the frontmatter when a name: value actually exists — the
  // missing-name case must not fall back to injecting text at 0:0.
  const entry = ws.entryOf(skill)
  if (entry?.frontmatter?.nameRange) {
    targets.push({ range: entry.frontmatter.nameRange, uri: entry.uri })
  }
  return targets
}

const renameTextEdits = (
  ws: Workspace,
  skill: Skill,
  newName: string
): TextDocumentEdit[] =>
  Object.entries(groupBy(renameLocations(ws, skill), (loc) => loc.uri)).map(
    ([uri, locs]) => ({
      edits: locs.map((loc) => ({ newText: newName, range: loc.range })),
      textDocument: { uri, version: null },
    })
  )
