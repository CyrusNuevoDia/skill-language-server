import { afterAll, beforeAll, expect, test } from "bun:test"
import type { WorkspaceEdit } from "vscode-languageserver-protocol"
import { expectedShippingEdits, SHIPPING_DECL } from "./corpus"
import {
  Client,
  posOf,
  rangeOf,
  renameFilesOf,
  sortEdits,
  textEditsOf,
  uriFor,
} from "./harness"

let c: Client
beforeAll(async () => {
  c = await Client.start()
})
afterAll(() => c.stop())

test("prepareRename on a reference returns name-only range + placeholder", async () => {
  const res = await c.prepareRename(
    ".claude/CLAUDE.md",
    posOf(".claude/CLAUDE.md", "/shipping", { offset: 3 })
  )
  expect(res).toEqual({
    placeholder: "shipping",
    range: rangeOf(".claude/CLAUDE.md", "/shipping", { length: 8, offset: 1 }),
  })
})

test("prepareRename on plain prose returns null", async () => {
  const res = await c.prepareRename(
    ".claude/CLAUDE.md",
    posOf(".claude/CLAUDE.md", "estimating", { offset: 2 })
  )
  expect(res).toBeNull()
})

test("rename from a reference: folder RenameFile + frontmatter + all references", async () => {
  const we = (await c.rename(
    ".claude/CLAUDE.md",
    posOf(".claude/CLAUDE.md", "/shipping", { offset: 3 }),
    "express-shipping"
  )) as WorkspaceEdit

  expect(renameFilesOf(we)).toEqual([
    {
      newUri: uriFor(".claude/skills/express-shipping"),
      oldUri: uriFor(".claude/skills/shipping"),
    },
  ])

  // The folder rename must come after the text edits that touch old paths.
  const dcs = we.documentChanges ?? []
  expect(dcs.length).toBeGreaterThan(0)
  const last = dcs.at(-1) as any
  expect(last.kind).toBe("rename")

  expect(textEditsOf(we)).toEqual(
    sortEdits(expectedShippingEdits("express-shipping"))
  )
})

test("rename triggered from the frontmatter name value produces the same edit", async () => {
  const we = (await c.rename(
    SHIPPING_DECL.rel,
    posOf(SHIPPING_DECL.rel, SHIPPING_DECL.needle, {
      offset: SHIPPING_DECL.offset + 2,
    }),
    "express-shipping"
  )) as WorkspaceEdit

  expect(renameFilesOf(we)).toEqual([
    {
      newUri: uriFor(".claude/skills/express-shipping"),
      oldUri: uriFor(".claude/skills/shipping"),
    },
  ])
  expect(textEditsOf(we)).toEqual(
    sortEdits(expectedShippingEdits("express-shipping"))
  )
})

test("rename rejects invalid skill names", async () => {
  await expect(
    c.rename(
      ".claude/CLAUDE.md",
      posOf(".claude/CLAUDE.md", "/shipping", { offset: 3 }),
      "Express Shipping"
    )
  ).rejects.toThrow()
})

test("rename rejects collisions with existing skill names", async () => {
  await expect(
    c.rename(
      ".claude/CLAUDE.md",
      posOf(".claude/CLAUDE.md", "/shipping", { offset: 3 }),
      "billing"
    )
  ).rejects.toThrow()
})
