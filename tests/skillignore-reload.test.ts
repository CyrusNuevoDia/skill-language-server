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
  expect(await c.diagnosticsFor(typoRel)).toHaveLength(2)

  writeFileSync(
    join(root, ".skillignore"),
    "ignored/\n.claude/skills/typo-source/\n"
  )
  await c.conn.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: [{ type: FileChangeType.Changed, uri: c.uriFor(".skillignore") }],
  })

  await c.settle()
  expect(c.diagnostics.get(c.uriFor(typoRel))).toEqual([])
})
