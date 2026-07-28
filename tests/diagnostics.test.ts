import { expect, test } from "bun:test"
import { DiagnosticSeverity } from "vscode-languageserver-protocol"
import { contentOf, rangeOf, startClient, uriFor } from "./_harness"

const c = await startClient()

test("near-miss reference gets a did-you-mean warning; other unknown references get an info hint", async () => {
  const diags = await c.diagnosticsFor(".claude/skills/typo-source/SKILL.md")
  expect(diags).toHaveLength(2)

  const warning = diags.find((d) => d.severity === DiagnosticSeverity.Warning)
  expect(warning?.message).toContain("shipping")
  expect(warning?.range).toEqual(
    rangeOf(".claude/skills/typo-source/SKILL.md", "/shiping", {
      length: 7,
      offset: 1,
    })
  )

  const info = diags.find((d) => d.severity === DiagnosticSeverity.Information)
  expect(info?.message).toContain("completely-unknown")
  expect(info?.range).toEqual(
    rangeOf(".claude/skills/typo-source/SKILL.md", "/completely-unknown", {
      length: 18,
      offset: 1,
    })
  )
})

test("builtin command names produce no diagnostics, even as near-misses of real skills", async () => {
  await c.settle()
  expect(c.diagnostics.has(uriFor(".claude/builtins.md"))).toBe(false)
})

test("commands defined by .claude/commands or .codex/prompts files produce no diagnostics", async () => {
  await c.settle()
  expect(c.diagnostics.has(uriFor(".claude/custom-commands.md"))).toBe(false)
})

test("dollar sigils skip the builtin list but never get the unknown-reference hint", async () => {
  const diags = await c.diagnosticsFor(".claude/sigils.md")
  expect(diags).toHaveLength(1)
  const [d] = diags
  expect(d.severity).toBe(DiagnosticSeverity.Warning)
  expect(d.message).toContain("modal")
  expect(d.range).toEqual(
    rangeOf(".claude/sigils.md", "$model", { length: 5, offset: 1 })
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
  expect(diags[0].message).toContain("name")
  expect(diags[0].message).toContain("noname")
})

test("clean files never receive a publish, not even an empty one", async () => {
  await c.settle()
  expect(c.diagnostics.has(uriFor(".claude/skills/billing/SKILL.md"))).toBe(
    false
  )
})

test("out-of-scope markdown never receives diagnostics", async () => {
  // Settle so the full workspace scan has landed, then check the absence.
  await c.settle()
  expect(c.diagnostics.has(uriFor("docs/guide.md"))).toBe(false)
})

test("diagnostics going non-empty to empty get exactly one clearing publish", async () => {
  const rel = ".claude/skills/shipping/SKILL.md"
  const uri = c.uriFor(rel)
  const countEmpties = () =>
    c.publishLog.filter((p) => p.uri === uri && p.diagnostics.length === 0)
      .length

  await c.open(rel, contentOf(rel).replace("name: shipping", "name: shippin"))
  await c.settle()
  expect(c.diagnostics.get(uri)?.length).toBeGreaterThan(0)

  const before = countEmpties()
  await c.close(rel)
  await c.settle()
  expect(countEmpties() - before).toBe(1)
  expect(c.diagnostics.get(uri)).toEqual([])
})
