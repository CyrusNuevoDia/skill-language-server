import { afterAll, beforeAll, expect, test } from "bun:test"
import {
  asLocations,
  Client,
  completionItemsOf,
  posOf,
  uriFor,
} from "./harness"

let c: Client
beforeAll(async () => {
  c = await Client.start()
})
afterAll(() => c.stop())

test("skills under .skillignore'd dirs are not offered in completion", async () => {
  await c.open(".claude/draft-ignore.md", "Try /")
  const items = completionItemsOf(
    await c.completion(".claude/draft-ignore.md", { character: 5, line: 0 })
  )
  const labels = items.map((i) => i.label)
  expect(labels).toContain("shipping")
  expect(labels).not.toContain("decoy")
})

test("ignored files get no features even when opened", async () => {
  await c.open("ignored/skills/decoy/SKILL.md")
  const res = await c.definition(
    "ignored/skills/decoy/SKILL.md",
    posOf("ignored/skills/decoy/SKILL.md", "/shipping", { offset: 3 })
  )
  expect(asLocations(res)).toEqual([])
})

test("ignored files never receive diagnostics", async () => {
  // The decoy contains /shiping, which would warn if it were indexed.
  await c.settle()
  expect(c.diagnostics.has(uriFor("ignored/skills/decoy/SKILL.md"))).toBe(false)
})

test("a ! negation pattern re-includes a subtree of an ignored dir", async () => {
  // .skillignore pairs `ignored/*` with `!ignored/keep/`: the decoy stays
  // out while the rescued skill is indexed like any other.
  await c.open(".claude/draft-negation.md", "Try /")
  const items = completionItemsOf(
    await c.completion(".claude/draft-negation.md", { character: 5, line: 0 })
  )
  const labels = items.map((i) => i.label)
  expect(labels).toContain("rescued")
  expect(labels).not.toContain("decoy")
})

test("references resolve into a re-included skill", async () => {
  await c.open(".claude/draft-negation-ref.md", "See /rescued")
  const res = await c.definition(".claude/draft-negation-ref.md", {
    character: 6,
    line: 0,
  })
  const locations = asLocations(res)
  expect(locations).toHaveLength(1)
  expect(locations[0]?.uri).toBe(uriFor("ignored/keep/skills/rescued/SKILL.md"))
})
