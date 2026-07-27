import { afterAll, beforeAll, expect, test } from "bun:test"
import { cpSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DidChangeWatchedFilesNotification,
  FileChangeType,
} from "vscode-languageserver-protocol"
import { Client, WORKSPACE } from "./harness"

let root: string
let c: Client
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "skill-language-server-reload-"))
  cpSync(WORKSPACE, root, { recursive: true })
  c = await Client.start(root)
})
afterAll(() => c.stop())

test("adding a path to .skillignore clears its on-screen diagnostics", async () => {
  const typoRel = ".claude/skills/typo-source/SKILL.md"
  expect(await c.diagnosticsFor(typoRel)).toHaveLength(1)

  writeFileSync(
    join(root, ".skillignore"),
    "ignored/\n.claude/skills/typo-source/\n"
  )
  await c.conn.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: [{ type: FileChangeType.Changed, uri: c.uriFor(".skillignore") }],
  })

  const uri = c.uriFor(typoRel)
  const deadline = Date.now() + 3000
  for (;;) {
    if (c.diagnostics.get(uri)?.length === 0) {
      break
    }
    if (Date.now() > deadline) {
      throw new Error("stale diagnostics were never cleared")
    }
    // biome-ignore lint/performance/noAwaitInLoops: polling for the clear
    await new Promise((r) => setTimeout(r, 25))
  }
  expect(c.diagnostics.get(uri)).toEqual([])
})
