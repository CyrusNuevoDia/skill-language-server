import { basename, dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { groupBy } from "es-toolkit"
import {
  type CompletionItem,
  CompletionItemKind,
  type Connection,
  ErrorCodes,
  type InitializeParams,
  LSPErrorCodes,
  ResourceOperationKind,
  ResponseError,
  type TextDocumentEdit,
  TextDocumentSyncKind,
  TextDocuments,
  type WorkspaceEdit,
} from "vscode-languageserver"
import { TextDocument } from "vscode-languageserver-textdocument"
import { MAX_NAME_LENGTH, NAME_RE, type Skill, Workspace } from "./workspace"

const TYPED_PREFIX = /^[a-z0-9-]*$/

export function startServer(connection: Connection): void {
  const documents = new TextDocuments(TextDocument)
  let ws: Workspace | null = null
  let supportsRenameFile = false

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

    return {
      capabilities: {
        completionProvider: { triggerCharacters: ["/", "$"] },
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
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
    ws.scan()
    for (const entry of ws.files.values()) {
      connection.sendDiagnostics({
        diagnostics: ws.diagnosticsFor(entry),
        uri: entry.uri,
      })
    }
  })

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
    if (!ws) {
      return null
    }
    const doc = documents.get(textDocument.uri)
    if (!doc) {
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
  const decl = ws.definitionOf(skill)
  const targets = [...ws.referencesTo(skill.name), decl]
  const byUri = groupBy(targets, (loc) => loc.uri)
  return Object.entries(byUri).map(([uri, locs]) => ({
    edits: locs.map((loc) => ({ newText: newName, range: loc.range })),
    textDocument: { uri, version: null },
  }))
}
