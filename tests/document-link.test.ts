import { afterAll, beforeAll, expect, test } from "bun:test"
import { Client, rangeOf, uriFor } from "./harness"

let c: Client
beforeAll(async () => {
  c = await Client.start()
})
afterAll(() => c.stop())

test("document links target resolved /shipping references", async () => {
  const rel = ".claude/skills/billing/SKILL.md"
  const target = uriFor(".claude/skills/shipping/SKILL.md")
  const res = await c.documentLinks(rel)

  expect(res ?? []).toEqual([
    {
      range: rangeOf(rel, "/shipping", { length: 9, occurrence: 1 }),
      target,
    },
    {
      range: rangeOf(rel, "/shipping", { length: 9, occurrence: 2 }),
      target,
    },
  ])
})

test("document links omit unresolved references", async () => {
  const res = await c.documentLinks(".claude/skills/typo-source/SKILL.md")

  expect(res ?? []).toEqual([])
})
