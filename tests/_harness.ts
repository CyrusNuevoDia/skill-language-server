import { afterAll } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { PassThrough } from "node:stream"
import { pathToFileURL } from "node:url"
import { sortBy } from "es-toolkit"
import { createConnection } from "vscode-languageserver/node"
import {
  type ClientCapabilities,
  type CompletionItem,
  type CompletionList,
  CompletionRequest,
  DefinitionRequest,
  type Diagnostic,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentLinkRequest,
  InitializedNotification,
  InitializeRequest,
  type Location,
  type LocationLink,
  type Position,
  PrepareRenameRequest,
  PublishDiagnosticsNotification,
  type Range,
  ReferencesRequest,
  type RenameFile,
  RenameRequest,
  SemanticTokensRequest,
  type TextEdit,
  WillRenameFilesRequest,
  type WorkspaceEdit,
} from "vscode-languageserver-protocol"
import {
  createProtocolConnection,
  type ProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-languageserver-protocol/node"
import { startServer } from "../src/server"

export const WORKSPACE = resolve(import.meta.dir, "fixtures", "workspace")

export const DEFAULT_CAPABILITIES: ClientCapabilities = {
  textDocument: {
    completion: {
      completionItem: { documentationFormat: ["markdown", "plaintext"] },
    },
    documentLink: {},
    publishDiagnostics: {},
    rename: { prepareSupport: true },
    semanticTokens: {
      formats: ["relative"],
      requests: { full: true },
      tokenModifiers: [],
      tokenTypes: ["function"],
    },
  },
  workspace: {
    fileOperations: { willRename: true },
    workspaceEdit: {
      documentChanges: true,
      resourceOperations: ["create", "rename", "delete"],
    },
    workspaceFolders: true,
  },
}

export const uriFor = (rel: string): string =>
  pathToFileURL(resolve(WORKSPACE, rel)).toString()

export const contentOf = (rel: string): string =>
  readFileSync(resolve(WORKSPACE, rel), "utf8")

/** Position of the nth occurrence of `needle` in a fixture file, plus `offset` chars. */
export function posOf(
  rel: string,
  needle: string,
  { occurrence = 1, offset = 0 }: { occurrence?: number; offset?: number } = {}
): Position {
  const text = contentOf(rel)
  let idx = -1
  for (let i = 0; i < occurrence; i += 1) {
    idx = text.indexOf(needle, idx + 1)
    if (idx === -1) {
      throw new Error(`"${needle}" (x${occurrence}) not found in ${rel}`)
    }
  }
  const at = idx + offset
  const before = text.slice(0, at)
  const line = before.split("\n").length - 1
  const character = at - (before.lastIndexOf("\n") + 1)
  return { character, line }
}

/** Single-line range starting at posOf(...) spanning `length` chars. */
export function rangeOf(
  rel: string,
  needle: string,
  opts: { occurrence?: number; offset?: number; length: number }
): Range {
  const start = posOf(rel, needle, opts)
  return {
    end: { character: start.character + opts.length, line: start.line },
    start,
  }
}

export class Client {
  readonly diagnostics = new Map<string, Diagnostic[]>()
  /** Every publishDiagnostics notification received, in arrival order. */
  readonly publishLog: { uri: string; diagnostics: Diagnostic[] }[] = []
  readonly conn: ProtocolConnection
  readonly root: string

  private constructor(conn: ProtocolConnection, root: string) {
    this.conn = conn
    this.root = root
  }

  /** Resolve a workspace-relative path against THIS client's root. */
  uriFor(rel: string): string {
    return pathToFileURL(resolve(this.root, rel)).toString()
  }

  static async start(
    root: string = WORKSPACE,
    capabilities: ClientCapabilities = DEFAULT_CAPABILITIES
  ): Promise<Client> {
    const clientToServer = new PassThrough()
    const serverToClient = new PassThrough()

    startServer(createConnection(clientToServer, serverToClient))

    const conn = createProtocolConnection(
      new StreamMessageReader(serverToClient),
      new StreamMessageWriter(clientToServer)
    )
    const client = new Client(conn, root)
    conn.onNotification(PublishDiagnosticsNotification.type, (p) => {
      client.diagnostics.set(p.uri, p.diagnostics)
      client.publishLog.push({ diagnostics: p.diagnostics, uri: p.uri })
    })
    conn.listen()

    const rootUri = pathToFileURL(root).toString()
    await conn.sendRequest(InitializeRequest.type, {
      capabilities,
      processId: null,
      rootUri,
      workspaceFolders: [{ name: "fixture", uri: rootUri }],
    })
    await conn.sendNotification(InitializedNotification.type, {})
    return client
  }

  stop(): void {
    this.conn.dispose()
  }

  async open(rel: string, text?: string): Promise<void> {
    await this.conn.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        languageId: "markdown",
        text: text ?? (await Bun.file(resolve(this.root, rel)).text()),
        uri: this.uriFor(rel),
        version: 1,
      },
    })
  }

  close(rel: string): Promise<void> {
    return this.conn.sendNotification(DidCloseTextDocumentNotification.type, {
      textDocument: { uri: this.uriFor(rel) },
    })
  }

  definition(rel: string, position: Position) {
    return this.conn.sendRequest(DefinitionRequest.type, {
      position,
      textDocument: { uri: this.uriFor(rel) },
    })
  }

  semanticTokens(rel: string) {
    return this.conn.sendRequest(SemanticTokensRequest.type, {
      textDocument: { uri: this.uriFor(rel) },
    })
  }

  documentLinks(rel: string) {
    return this.conn.sendRequest(DocumentLinkRequest.type, {
      textDocument: { uri: this.uriFor(rel) },
    })
  }

  references(rel: string, position: Position, includeDeclaration = false) {
    return this.conn.sendRequest(ReferencesRequest.type, {
      context: { includeDeclaration },
      position,
      textDocument: { uri: this.uriFor(rel) },
    })
  }

  prepareRename(rel: string, position: Position) {
    return this.conn.sendRequest(PrepareRenameRequest.type, {
      position,
      textDocument: { uri: this.uriFor(rel) },
    })
  }

  rename(rel: string, position: Position, newName: string) {
    return this.conn.sendRequest(RenameRequest.type, {
      newName,
      position,
      textDocument: { uri: this.uriFor(rel) },
    })
  }

  willRenameFolder(oldRel: string, newRel: string) {
    return this.conn.sendRequest(WillRenameFilesRequest.type, {
      files: [{ newUri: this.uriFor(newRel), oldUri: this.uriFor(oldRel) }],
    })
  }

  completion(rel: string, position: Position) {
    return this.conn.sendRequest(CompletionRequest.type, {
      position,
      textDocument: { uri: this.uriFor(rel) },
    })
  }

  /**
   * Round-trip a cheap request. The server serializes index mutations through
   * one promise chain and request handlers await its tail, so once the
   * response arrives every publish triggered by earlier notifications has
   * landed in `diagnostics`.
   */
  async settle(): Promise<void> {
    await this.conn.sendRequest(DefinitionRequest.type, {
      position: { character: 0, line: 0 },
      textDocument: { uri: pathToFileURL(this.root).toString() },
    })
  }

  /** Wait until the server has published diagnostics (possibly empty) for a file. */
  async diagnosticsFor(rel: string, timeoutMs = 3000): Promise<Diagnostic[]> {
    const uri = this.uriFor(rel)
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const published = this.diagnostics.get(uri)
      if (published) {
        return published
      }
      if (Date.now() > deadline) {
        throw new Error(`no diagnostics published for ${rel}`)
      }
      // biome-ignore lint/performance/noAwaitInLoops: polling until the server publishes
      await Bun.sleep(25)
    }
  }
}

/** Start a Client scoped to the calling test file: stopped in its afterAll. */
export async function startClient(
  root: string = WORKSPACE,
  capabilities: ClientCapabilities = DEFAULT_CAPABILITIES
): Promise<Client> {
  const client = await Client.start(root, capabilities)
  afterAll(() => client.stop())
  return client
}

// ---- result normalizers ------------------------------------------------

/** Normalize Definition | Location[] | LocationLink[] | null to Location[]. */
export function asLocations(res: unknown): Location[] {
  if (!res) {
    return []
  }
  const arr = (Array.isArray(res) ? res : [res]) as (Location | LocationLink)[]
  return arr.map((l) =>
    "targetUri" in l
      ? { range: l.targetSelectionRange ?? l.targetRange, uri: l.targetUri }
      : l
  )
}

/** Sort anything uri-and-range-shaped (Locations, FlatEdits) into a stable order. */
export const sortByPos = <T extends { uri: string; range: Range }>(
  items: T[]
): T[] =>
  sortBy(items, [
    (x) => x.uri,
    (x) => x.range.start.line,
    (x) => x.range.start.character,
  ])

export type FlatEdit = {
  newText: string
  range: Range
  uri: string
}

export function textEditsOf(we: WorkspaceEdit): FlatEdit[] {
  const out: FlatEdit[] = []
  for (const dc of we.documentChanges ?? []) {
    if ("textDocument" in dc) {
      for (const e of dc.edits as TextEdit[]) {
        out.push({
          newText: e.newText,
          range: e.range,
          uri: dc.textDocument.uri,
        })
      }
    }
  }
  for (const [uri, edits] of Object.entries(we.changes ?? {})) {
    for (const e of edits) {
      out.push({ newText: e.newText, range: e.range, uri })
    }
  }
  return sortByPos(out)
}

export const renameFilesOf = (
  we: WorkspaceEdit
): Array<{ oldUri: string; newUri: string }> =>
  (we.documentChanges ?? [])
    .filter((dc): dc is RenameFile => "kind" in dc && dc.kind === "rename")
    .map((r) => ({ newUri: r.newUri, oldUri: r.oldUri }))

export function completionItemsOf(res: unknown): CompletionItem[] {
  if (!res) {
    return []
  }
  return Array.isArray(res)
    ? (res as CompletionItem[])
    : ((res as CompletionList).items ?? [])
}
