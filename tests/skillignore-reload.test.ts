import { expect, test } from "bun:test"
import { cpSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DidChangeWatchedFilesNotification,
  FileChangeType,
} from "vscode-languageserver-protocol"
import { startClient, WORKSPACE } from "./helpers/harness"

const root = mkdtempSync(join(tmpdir(), "skill-language-server-reload-"))
cpSync(WORKSPACE, root, { recursive: true })
const c = await startClient(root)

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
