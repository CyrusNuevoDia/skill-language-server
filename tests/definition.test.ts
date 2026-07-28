import { expect, test } from "bun:test"
import { locOf, SHIPPING_DECL } from "./corpus"
import { asLocations, posOf, startClient } from "./helpers/harness"

const c = await startClient()

const SHIPPING_DEF = [locOf(SHIPPING_DECL)]

test("definition from /shipping prose reference", async () => {
  const res = await c.definition(
    ".claude/skills/billing/SKILL.md",
    posOf(".claude/skills/billing/SKILL.md", "/shipping", { offset: 3 })
  )
  expect(asLocations(res)).toEqual(SHIPPING_DEF)
})

test("definition works with cursor on the sigil itself", async () => {
  const res = await c.definition(
    ".claude/CLAUDE.md",
    posOf(".claude/CLAUDE.md", "/shipping", { offset: 0 })
  )
  expect(asLocations(res)).toEqual(SHIPPING_DEF)
})

test("definition from $shipping reference", async () => {
  const res = await c.definition(
    ".claude/agents/reviewer.md",
    posOf(".claude/agents/reviewer.md", "$shipping", { offset: 4 })
  )
  expect(asLocations(res)).toEqual(SHIPPING_DEF)
})

test("definition from reference inside inline code span", async () => {
  const res = await c.definition(
    ".claude/skills/billing/SKILL.md",
    posOf(".claude/skills/billing/SKILL.md", "/shipping", {
      occurrence: 2,
      offset: 3,
    })
  )
  expect(asLocations(res)).toEqual(SHIPPING_DEF)
})

test("no definition inside fenced code blocks", async () => {
  const res = await c.definition(
    ".claude/skills/shipping/SKILL.md",
    posOf(".claude/skills/shipping/SKILL.md", "$billing", {
      occurrence: 2,
      offset: 3,
    })
  )
  expect(asLocations(res)).toEqual([])
})

test("no definition for unknown tokens", async () => {
  const res = await c.definition(
    ".claude/skills/typo-source/SKILL.md",
    posOf(".claude/skills/typo-source/SKILL.md", "/completely-unknown", {
      offset: 3,
    })
  )
  expect(asLocations(res)).toEqual([])
})

test("no definition on plain prose", async () => {
  const res = await c.definition(
    ".claude/CLAUDE.md",
    posOf(".claude/CLAUDE.md", "estimating", { offset: 2 })
  )
  expect(asLocations(res)).toEqual([])
})
