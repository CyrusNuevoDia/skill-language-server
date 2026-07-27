import { basename, dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { groupBy } from "es-toolkit"
import {
  type CompletionItem,
  CompletionItemKind,
  type Connection,
  DidChangeWatchedFilesNotification,
  type DocumentLink,
  ErrorCodes,
  FileChangeType,
  type InitializeParams,
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
import { BAD_PREV } from "./parse"
import { MAX_NAME_LENGTH, NAME_RE, type Skill, Workspace } from "./workspace"

const TYPED_PREFIX = /^[a-z0-9_:-]*$/

export function startServer(connection: Connection): void {
  const documents = new TextDocuments(TextDocument)
  let ws: Workspace | null = null
  let supportsRenameFile = false
  let supportsWatchedFiles = false

  connection.onInitialize((params: InitializeParams) => {
    const rootUri = params.workspaceFolders?.[0]?.uri ?? params.rootUri
    if (rootUri) {
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
    if (!ws) {
      return
    }
    if (supportsWatchedFiles) {
      connection.client
        .register(DidChangeWatchedFilesNotification.type, {
          watchers: [
            { globPattern: "**/*.md" },
            { globPattern: "**/.skillignore" },
          ],
        })
        .catch(() => {
          // Client declined; didOpen-based reindexing still works.
        })
    }
    ws.scan()
    publishAll()
  })

  connection.onDidChangeWatchedFiles(({ changes }) => {
    if (!ws) {
      return
    }
    for (const change of changes) {
      applyWatchedChange(change.type, change.uri)
    }
    if (changes.some((c) => isSkillignore(c.uri))) {
      rescanPreservingOpenBuffers()
    }
    // Duplicate/mismatch diagnostics depend on global state; republish all.
    publishAll()
  })

  function isSkillignore(uri: string): boolean {
    return (
      uri.startsWith("file:") && basename(fileURLToPath(uri)) === ".skillignore"
    )
  }

  function applyWatchedChange(type: FileChangeType, uri: string): void {
    if (!(ws && uri.startsWith("file:")) || isSkillignore(uri)) {
      return
    }
    // An open buffer is authoritative over disk until the editor closes it.
    if (documents.get(uri)) {
      return
    }
    const path = fileURLToPath(uri)
    if (!ws.inScope(path)) {
      return
    }
    if (type === FileChangeType.Deleted) {
      ws.removeFile(uri)
      connection.sendDiagnostics({ diagnostics: [], uri })
    } else {
      ws.reindexPath(path)
    }
  }

  function rescanPreservingOpenBuffers(): void {
    if (!ws) {
      return
    }
    const before = new Set(ws.files.keys())
    ws.scan()
    // scan() reads disk; restore index entries for dirty open buffers.
    for (const doc of documents.all()) {
      if (!doc.uri.startsWith("file:")) {
        continue
      }
      const path = fileURLToPath(doc.uri)
      if (ws.inScope(path)) {
        ws.indexFile(path, doc.getText())
      }
    }
    // Files the rescan dropped (newly ignored) keep stale diagnostics on
    // screen unless we explicitly clear them.
    for (const uri of before) {
      if (!ws.files.has(uri)) {
        connection.sendDiagnostics({ diagnostics: [], uri })
      }
    }
  }

  function publishAll(): void {
    if (!ws) {
      return
    }
    for (const entry of ws.files.values()) {
      connection.sendDiagnostics({
        diagnostics: ws.diagnosticsFor(entry),
        uri: entry.uri,
      })
    }
  }

  documents.onDidChangeContent(({ document }) => {
    if (!(ws && document.uri.startsWith("file:"))) {
      return
    }
    const path = fileURLToPath(document.uri)
    if (!ws.inScope(path)) {
      return
    }
    const entry = ws.indexFile(path, document.getText())
    connection.sendDiagnostics({
      diagnostics: ws.diagnosticsFor(entry),
      uri: entry.uri,
    })
  })

  connection.onDefinition(({ textDocument, position }) => {
    const token = ws?.tokenAt(textDocument.uri, position)
    const skill = token && ws?.skillOf(token.name)
    return skill ? ws?.definitionOf(skill) : null
  })

  connection.languages.semanticTokens.on(({ textDocument }) => {
    if (!(ws && textDocument.uri.startsWith("file:"))) {
      return { data: [] }
    }
    const entry = ws.files.get(textDocument.uri)
    if (!entry) {
      return { data: [] }
    }
    const builder = new SemanticTokensBuilder()
    for (const token of entry.tokens) {
      if (ws.skillOf(token.name)) {
        builder.push(
          token.line,
          token.startChar,
          token.nameRange.end.character - token.startChar,
          0,
          0
        )
      }
    }
    return builder.build()
  })

  connection.onDocumentLinks(({ textDocument }) => {
    if (!(ws && textDocument.uri.startsWith("file:"))) {
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
          range: {
            end: token.nameRange.end,
            start: { character: token.startChar, line: token.line },
          },
          target: pathToFileURL(skill.skillFilePath).toString(),
        })
      }
    }
    return links
  })

  connection.onReferences(({ textDocument, position, context }) => {
    if (!ws) {
      return null
    }
    const skill = ws.skillAt(textDocument.uri, position)
    if (!skill) {
      return null
    }
    const refs = ws.referencesTo(skill.name)
    return context.includeDeclaration ? [...refs, ws.definitionOf(skill)] : refs
  })

  connection.onPrepareRename(({ textDocument, position }) => {
    if (!ws) {
      return null
    }
    const token = ws.tokenAt(textDocument.uri, position)
    if (token && ws.skillOf(token.name)) {
      return { placeholder: token.name, range: token.nameRange }
    }
    const decl = ws.declAt(textDocument.uri, position)
    if (!decl) {
      return null
    }
    const entry = ws.files.get(textDocument.uri)
    if (entry?.frontmatter?.nameRange) {
      return { placeholder: decl, range: entry.frontmatter.nameRange }
    }
    return null
  })

  connection.onRenameRequest(({ textDocument, position, newName }) => {
    if (!ws) {
      return null
    }
    const skill = ws.skillAt(textDocument.uri, position)
    if (!skill) {
      return null
    }

    if (!NAME_RE.test(newName) || newName.length > MAX_NAME_LENGTH) {
      throw new ResponseError(
        ErrorCodes.InvalidParams,
        `Invalid skill name "${newName}": must match ${NAME_RE} and be ≤${MAX_NAME_LENGTH} chars.`
      )
    }
    if (newName !== skill.name && ws.skills.has(newName)) {
      throw new ResponseError(
        LSPErrorCodes.RequestFailed,
        `A skill named "${newName}" already exists.`
      )
    }

    const edits = renameTextEdits(ws, skill, newName)
    if (!supportsRenameFile) {
      // Degraded client: text edits only; the folder must be renamed manually.
      return { documentChanges: edits } satisfies WorkspaceEdit
    }
    return {
      documentChanges: [
        ...edits,
        {
          kind: "rename" as const,
          newUri: pathToFileURL(
            join(dirname(skill.folderPath), newName)
          ).toString(),
          oldUri: pathToFileURL(skill.folderPath).toString(),
        },
      ],
    } satisfies WorkspaceEdit
  })

  connection.workspace.onWillRenameFiles(({ files }) => {
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
      if (!NAME_RE.test(newName) || newName.length > MAX_NAME_LENGTH) {
        continue
      }
      edits.push(...renameTextEdits(ws, skill, newName))
    }
    return edits.length > 0 ? { documentChanges: edits } : null
  })

  connection.onCompletion(({ textDocument, position }) => {
    if (!(ws && textDocument.uri.startsWith("file:"))) {
      return null
    }
    const doc = documents.get(textDocument.uri)
    if (!(doc && ws.inScope(fileURLToPath(textDocument.uri)))) {
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

    const items: CompletionItem[] = []
    for (const [name, entries] of ws.skills) {
      const entry = ws.entryOf(entries[0])
      items.push({
        documentation: {
          kind: "markdown",
          value: entry?.frontmatter?.description ?? "",
        },
        kind: CompletionItemKind.Reference,
        label: name,
      })
    }
    return items
  })

  documents.listen(connection)
  connection.listen()
}

/** All text edits for renaming a skill: every reference plus the frontmatter name. */
function renameTextEdits(
  ws: Workspace,
  skill: Skill,
  newName: string
): TextDocumentEdit[] {
  const targets = ws.referencesTo(skill.name)
  // Only edit the frontmatter when a name: value actually exists — the
  // missing-name case must not fall back to injecting text at 0:0.
  const entry = ws.entryOf(skill)
  if (entry?.frontmatter?.nameRange) {
    targets.push({ range: entry.frontmatter.nameRange, uri: entry.uri })
  }
  const byUri = groupBy(targets, (loc) => loc.uri)
  return Object.entries(byUri).map(([uri, locs]) => ({
    edits: locs.map((loc) => ({ newText: newName, range: loc.range })),
    textDocument: { uri, version: null },
  }))
}
