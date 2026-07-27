import { join } from "node:path"
import type { ExtensionContext } from "vscode"
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node"

let client: LanguageClient | undefined

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(join("dist", "server.js"))
  const serverOptions: ServerOptions = {
    debug: { module: serverModule, transport: TransportKind.ipc },
    run: { module: serverModule, transport: TransportKind.ipc },
  }
  // Attach to all markdown; the server self-filters to skill scope
  // (skills/ dirs plus .claude/.agents/.codex) and stays quiet elsewhere.
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: "markdown", scheme: "file" }],
  }
  client = new LanguageClient(
    "skill-lsp",
    "Skill LSP",
    serverOptions,
    clientOptions
  )
  client.start()
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop()
}
