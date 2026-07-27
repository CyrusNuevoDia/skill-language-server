import { afterAll, beforeAll, expect, test } from "bun:test"
import type { WorkspaceEdit } from "vscode-languageserver-protocol"
import { expectedShippingEdits } from "./corpus"
import { Client, renameFilesOf, sortEdits, textEditsOf } from "./harness"

let c: Client
beforeAll(async () => {
  c = await Client.start()
})
afterAll(() => c.stop())

test("renaming the skill folder in the explorer updates frontmatter + references", async () => {
  const we = (await c.willRenameFolder(
    ".claude/skills/shipping",
    ".claude/skills/overnight"
  )) as WorkspaceEdit

  expect(we).toBeTruthy()
  // The client is performing the folder rename itself — no RenameFile op.
  expect(renameFilesOf(we)).toEqual([])
  // Edits reference OLD paths: the client applies them before moving files.
  expect(textEditsOf(we)).toEqual(sortEdits(expectedShippingEdits("overnight")))
})
