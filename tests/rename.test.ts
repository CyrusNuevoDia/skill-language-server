import { expect, test } from "bun:test"
import type { WorkspaceEdit } from "vscode-languageserver-protocol"
import { expectedShippingEdits, SHIPPING_DECL } from "./corpus"
import {
  Client,
  posOf,
  rangeOf,
  renameFilesOf,
  sortByPos,
  startClient,
  textEditsOf,
  uriFor,
  WORKSPACE,
} from "./helpers/harness"

const c = await startClient()

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
  expect(dcs.at(-1)).toMatchObject({ kind: "rename" })

  expect(textEditsOf(we)).toEqual(
    sortByPos(expectedShippingEdits("express-shipping"))
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
    sortByPos(expectedShippingEdits("express-shipping"))
  )
})

test("rename to the current name is a no-op, not a self-RenameFile", async () => {
  const res = await c.rename(
    ".claude/CLAUDE.md",
    posOf(".claude/CLAUDE.md", "/shipping", { offset: 3 }),
    "shipping"
  )
  expect(res).toBeNull()
})

async function renameTwin(folder: string): Promise<WorkspaceEdit> {
  const rel = `${folder}/SKILL.md`
  return (await c.rename(
    rel,
    posOf(rel, "name: deploy", { offset: 8 }),
    "deployz"
  )) as WorkspaceEdit
}

test("rename from a duplicate's declaration renames THAT twin's folder", async () => {
  const docsTwin = await renameTwin("docs/skills/deploy")
  expect(renameFilesOf(docsTwin)).toEqual([
    {
      newUri: uriFor("docs/skills/deployz"),
      oldUri: uriFor("docs/skills/deploy"),
    },
  ])
  const agentsTwin = await renameTwin(".agents/skills/deploy")
  expect(renameFilesOf(agentsTwin)).toEqual([
    {
      newUri: uriFor(".agents/skills/deployz"),
      oldUri: uriFor(".agents/skills/deploy"),
    },
  ])
  // Each twin's frontmatter edit lands in its own SKILL.md.
  expect(
    textEditsOf(agentsTwin).some(
      (e) => e.uri === uriFor(".agents/skills/deploy/SKILL.md")
    )
  ).toBe(true)
})

test("a client with neither documentChanges nor resourceOperations gets a plain changes map", async () => {
  const minimal = await Client.start(WORKSPACE, {
    textDocument: { rename: { prepareSupport: true } },
  })
  try {
    const we = (await minimal.rename(
      ".claude/CLAUDE.md",
      posOf(".claude/CLAUDE.md", "/shipping", { offset: 3 }),
      "express-shipping"
    )) as WorkspaceEdit
    expect(we.documentChanges).toBeUndefined()
    expect(textEditsOf(we)).toEqual(
      sortByPos(expectedShippingEdits("express-shipping"))
    )
  } finally {
    minimal.stop()
  }
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
