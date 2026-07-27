import { afterAll, beforeAll, expect, test } from "bun:test"
import { DiagnosticSeverity } from "vscode-languageserver-protocol"
import { Client, rangeOf, uriFor } from "./harness"

let c: Client
beforeAll(async () => {
  c = await Client.start()
})
afterAll(() => c.stop())

test("near-miss reference gets a did-you-mean warning; unknown tokens stay quiet", async () => {
  const diags = await c.diagnosticsFor(".claude/skills/typo-source/SKILL.md")
  expect(diags).toHaveLength(1)
  const [d] = diags
  expect(d.severity).toBe(DiagnosticSeverity.Warning)
  expect(d.message).toContain("shipping")
  expect(d.range).toEqual(
    rangeOf(".claude/skills/typo-source/SKILL.md", "/shiping", {
      length: 7,
      offset: 1,
    })
  )
})

test("frontmatter name that disagrees with folder name is an error", async () => {
  const diags = await c.diagnosticsFor(".claude/skills/mismatch/SKILL.md")
  expect(diags).toHaveLength(1)
  const [d] = diags
  expect(d.severity).toBe(DiagnosticSeverity.Error)
  expect(d.message).toContain("mismatch")
  expect(d.range).toEqual(
    rangeOf(".claude/skills/mismatch/SKILL.md", "name: totally-different", {
      length: 17,
      offset: 6,
    })
  )
})

const DUPLICATE = /duplicate/i

test("duplicate skill names are flagged on both definitions", async () => {
  const rels = ["docs/skills/deploy/SKILL.md", ".agents/skills/deploy/SKILL.md"]
  const diagsByRel = await Promise.all(rels.map((rel) => c.diagnosticsFor(rel)))
  for (const [i, rel] of rels.entries()) {
    const dup = diagsByRel[i].find((d) => DUPLICATE.test(String(d.message)))
    expect(dup).toBeTruthy()
    expect(dup?.severity).toBe(DiagnosticSeverity.Error)
    expect(dup?.range).toEqual(
      rangeOf(rel, "name: deploy", { length: 6, offset: 6 })
    )
  }
})

test("SKILL.md with no frontmatter name gets a missing-name error", async () => {
  const diags = await c.diagnosticsFor(".claude/skills/noname/SKILL.md")
  expect(diags).toHaveLength(1)
  expect(diags[0].severity).toBe(DiagnosticSeverity.Error)
  expect(String(diags[0].message)).toContain("name")
  expect(String(diags[0].message)).toContain("noname")
})

test("clean files get an explicit empty publish", async () => {
  expect(await c.diagnosticsFor(".claude/skills/billing/SKILL.md")).toEqual([])
})

test("out-of-scope markdown never receives diagnostics", async () => {
  // Wait for the full workspace scan to land, then check the absence.
  await c.diagnosticsFor(".claude/skills/typo-source/SKILL.md")
  await c.diagnosticsFor("docs/skills/deploy/SKILL.md")
  await new Promise((r) => setTimeout(r, 150))
  expect(c.diagnostics.has(uriFor("docs/guide.md"))).toBe(false)
})
