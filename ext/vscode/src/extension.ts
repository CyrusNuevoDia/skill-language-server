import { join } from "node:path"
import type { ExtensionContext } from "vscode"
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node"

let client: LanguageClient | undefined

// Attach to all markdown; the server self-filters to skill scope
// (skills/ dirs plus .claude/.agents/.codex) and stays quiet elsewhere.
const CLIENT_OPTIONS = {
  documentSelector: [{ language: "markdown", scheme: "file" }],
} as const satisfies LanguageClientOptions

function serverOptions(context: ExtensionContext): ServerOptions {
  const serverModule = context.asAbsolutePath(join("dist", "server.js"))
  return {
    debug: {
      module: serverModule,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
      transport: TransportKind.ipc,
    },
    run: { module: serverModule, transport: TransportKind.ipc },
  }
}

export function activate(context: ExtensionContext): void {
  client = new LanguageClient(
    "skill-language-server",
    "Skill Language Server",
    serverOptions(context),
    CLIENT_OPTIONS
  )
  client.start()
}

export const deactivate = () => client?.stop()
