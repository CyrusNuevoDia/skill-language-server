import { afterAll, beforeAll, expect, test } from "bun:test"
import type { WorkspaceEdit } from "vscode-languageserver-protocol"
import {
  asLocations,
  Client,
  completionItemsOf,
  posOf,
  rangeOf,
  renameFilesOf,
  sortLocs,
  textEditsOf,
  uriFor,
} from "./harness"

let c: Client
beforeAll(async () => {
  c = await Client.start()
})
afterAll(() => c.stop())

const dataSyncDef = {
  range: rangeOf(".claude/skills/data_sync/SKILL.md", "name: data_sync", {
    length: 9,
    offset: 6,
  }),
  uri: uriFor(".claude/skills/data_sync/SKILL.md"),
}

test("underscore names resolve: /data_sync and $data_sync", async () => {
  const slash = await c.definition(
    ".claude/team.md",
    posOf(".claude/team.md", "/data_sync", { offset: 4 })
  )
  const dollar = await c.definition(
    ".claude/team.md",
    posOf(".claude/team.md", "$data_sync", { offset: 4 })
  )
  expect(asLocations(slash)).toEqual([dataSyncDef])
  expect(asLocations(dollar)).toEqual([dataSyncDef])
})

test("colon names resolve: /report:weekly", async () => {
  const res = await c.definition(
    ".claude/skills/data_sync/SKILL.md",
    posOf(".claude/skills/data_sync/SKILL.md", "/report:weekly", { offset: 9 })
  )
  expect(asLocations(res)).toEqual([
    {
      range: rangeOf(
        ".claude/skills/report:weekly/SKILL.md",
        "name: report:weekly",
        { length: 13, offset: 6 }
      ),
      uri: uriFor(".claude/skills/report:weekly/SKILL.md"),
    },
  ])
})

test("a trailing colon in prose is not swallowed into the name", async () => {
  const res = await c.prepareRename(
    ".claude/team.md",
    posOf(".claude/team.md", "/shipping:", { offset: 3 })
  )
  expect(res).toEqual({
    placeholder: "shipping",
    range: rangeOf(".claude/team.md", "/shipping:", { length: 8, offset: 1 }),
  })
})

test("references find underscore-named skills", async () => {
  const res = await c.references(
    ".claude/team.md",
    posOf(".claude/team.md", "/data_sync", { offset: 4 })
  )
  expect(sortLocs(res ?? [])).toEqual(
    sortLocs([
      {
        range: rangeOf(".claude/team.md", "/data_sync", {
          length: 9,
          offset: 1,
        }),
        uri: uriFor(".claude/team.md"),
      },
      {
        range: rangeOf(".claude/team.md", "$data_sync", {
          length: 9,
          offset: 1,
        }),
        uri: uriFor(".claude/team.md"),
      },
    ])
  )
})

test("rename to a colon name renames the folder and references", async () => {
  const we = (await c.rename(
    ".claude/skills/data_sync/SKILL.md",
    posOf(".claude/skills/data_sync/SKILL.md", "/report:weekly", { offset: 9 }),
    "report:monthly"
  )) as WorkspaceEdit

  expect(renameFilesOf(we)).toEqual([
    {
      newUri: uriFor(".claude/skills/report:monthly"),
      oldUri: uriFor(".claude/skills/report:weekly"),
    },
  ])
  const edits = textEditsOf(we)
  expect(edits).toHaveLength(2)
  expect(edits.every((e) => e.newText === "report:monthly")).toBe(true)
})

test("rename rejects malformed separator runs and uppercase", async () => {
  const pos = posOf(".claude/team.md", "/data_sync", { offset: 4 })
  await expect(c.rename(".claude/team.md", pos, "a::b")).rejects.toThrow()
  await expect(c.rename(".claude/team.md", pos, "Data:Sync")).rejects.toThrow()
  await expect(c.rename(".claude/team.md", pos, "-leading")).rejects.toThrow()
})

test("completion offers underscore and colon names", async () => {
  await c.open(".claude/draft-names.md", "Try /")
  const labels = completionItemsOf(
    await c.completion(".claude/draft-names.md", { character: 5, line: 0 })
  ).map((i) => i.label)
  expect(labels).toContain("data_sync")
  expect(labels).toContain("report:weekly")
})
