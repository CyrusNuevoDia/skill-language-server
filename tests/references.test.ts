import { afterAll, beforeAll, expect, test } from "bun:test"
import { BILLING_REFS, locOf, SHIPPING_DECL, SHIPPING_REFS } from "./corpus"
import { Client, posOf, sortLocs } from "./harness"

let c: Client
beforeAll(async () => {
  c = await Client.start()
})
afterAll(() => c.stop())

test("references from the definition (frontmatter name)", async () => {
  const res = await c.references(
    SHIPPING_DECL.rel,
    posOf(SHIPPING_DECL.rel, SHIPPING_DECL.needle, {
      offset: SHIPPING_DECL.offset + 2,
    })
  )
  expect(sortLocs(res ?? [])).toEqual(sortLocs(SHIPPING_REFS.map(locOf)))
})

test("references with includeDeclaration adds the frontmatter name", async () => {
  const res = await c.references(
    SHIPPING_DECL.rel,
    posOf(SHIPPING_DECL.rel, SHIPPING_DECL.needle, {
      offset: SHIPPING_DECL.offset + 2,
    }),
    true
  )
  expect(sortLocs(res ?? [])).toEqual(
    sortLocs([...SHIPPING_REFS, SHIPPING_DECL].map(locOf))
  )
})

test("references from a reference position returns the same set", async () => {
  const res = await c.references(
    ".claude/CLAUDE.md",
    posOf(".claude/CLAUDE.md", "/shipping", { offset: 3 })
  )
  expect(sortLocs(res ?? [])).toEqual(sortLocs(SHIPPING_REFS.map(locOf)))
})

test("billing references exclude fenced code and out-of-scope files", async () => {
  const res = await c.references(
    ".codex/AGENTS.md",
    posOf(".codex/AGENTS.md", "/billing", { offset: 2 })
  )
  expect(sortLocs(res ?? [])).toEqual(sortLocs(BILLING_REFS.map(locOf)))
})
