import { expect, test } from "bun:test"
import {
  DidChangeWatchedFilesNotification,
  FileChangeType,
} from "vscode-languageserver-protocol"
import { asLocations, posOf, startClient, uriFor } from "./helpers/harness"

const c = await startClient()

const BILLING_SKILL = ".claude/skills/billing/SKILL.md"

const notifyChange = (type: FileChangeType) =>
  c.conn.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: [{ type, uri: uriFor(BILLING_SKILL) }],
  })

test("watcher events never override open buffers", async () => {
  // Buffer has the /shipping ref on line 3; the on-disk file has it on line 2.
  await c.open(".claude/CLAUDE.md", "a\nb\nc\nUse /shipping\n")
  await c.conn.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: [
      { type: FileChangeType.Changed, uri: uriFor(".claude/CLAUDE.md") },
    ],
  })
  const atBufferPos = await c.definition(".claude/CLAUDE.md", {
    character: 8,
    line: 3,
  })
  const atDiskPos = await c.definition(".claude/CLAUDE.md", {
    character: 33,
    line: 2,
  })
  expect(asLocations(atBufferPos)).toHaveLength(1)
  expect(asLocations(atDiskPos)).toEqual([])
})

test("watched-files delete drops a skill; re-create restores it", async () => {
  const pos = posOf(".codex/AGENTS.md", "/billing", { offset: 2 })

  expect(asLocations(await c.definition(".codex/AGENTS.md", pos))).toHaveLength(
    1
  )

  await notifyChange(FileChangeType.Deleted)
  expect(asLocations(await c.definition(".codex/AGENTS.md", pos))).toEqual([])

  await notifyChange(FileChangeType.Created)
  expect(asLocations(await c.definition(".codex/AGENTS.md", pos))).toHaveLength(
    1
  )
})

test("a folder delete (one event, no .md suffix) evicts everything under it", async () => {
  const pos = posOf(".codex/AGENTS.md", "/billing", { offset: 2 })

  await c.conn.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: [
      {
        type: FileChangeType.Deleted,
        uri: uriFor(".claude/skills/billing"),
      },
    ],
  })
  expect(asLocations(await c.definition(".codex/AGENTS.md", pos))).toEqual([])

  await notifyChange(FileChangeType.Created)
  expect(asLocations(await c.definition(".codex/AGENTS.md", pos))).toHaveLength(
    1
  )
})
