import { expect, test } from "bun:test"
import { pathToFileURL } from "node:url"
import fc from "fast-check"
import { DiagnosticSeverity } from "vscode-languageserver-protocol"
import { BUILTIN_COMMANDS } from "@/builtins"
import { distance } from "@/utils"
import { Workspace } from "@/workspace"

const str = fc.string({ maxLength: 12 })

test("distance: identity, symmetry, and length bounds", () => {
  fc.assert(
    fc.property(str, (a) => {
      expect(distance(a, a)).toBe(0)
    })
  )
  fc.assert(
    fc.property(str, str, (a, b) => {
      const d = distance(a, b)
      expect(distance(b, a)).toBe(d)
      // The length-gap lower bound is what licenses the prefilter in
      // Workspace.nearestSkillName: a gap beyond the threshold can be
      // skipped without computing the distance.
      expect(d).toBeGreaterThanOrEqual(Math.abs(a.length - b.length))
      expect(d).toBeLessThanOrEqual(Math.max(a.length, b.length))
    })
  )
})

type Edit = {
  at: number
  ch: string
  kind: "delete" | "insert" | "sub" | "swap"
}

const editArb = fc.record<Edit>({
  at: fc.nat(),
  ch: fc.constantFrom(..."abcxyz"),
  kind: fc.constantFrom("delete", "insert", "sub", "swap"),
})

function applyEdit(s: string, e: Edit): string {
  if (e.kind === "insert") {
    const i = e.at % (s.length + 1)
    return s.slice(0, i) + e.ch + s.slice(i)
  }
  if (s.length === 0) {
    return s
  }
  if (e.kind === "delete") {
    const i = e.at % s.length
    return s.slice(0, i) + s.slice(i + 1)
  }
  if (e.kind === "sub") {
    const i = e.at % s.length
    return s.slice(0, i) + e.ch + s.slice(i + 1)
  }
  if (s.length < 2) {
    return s
  }
  const i = e.at % (s.length - 1)
  return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2)
}

test("one edit of any kind — including a transposition — is at distance ≤ 1", () => {
  fc.assert(
    fc.property(str, editArb, (a, e) => {
      expect(distance(a, applyEdit(a, e))).toBeLessThanOrEqual(1)
    })
  )
})

// Swaps are excluded here on purpose: OSA distance is not a metric, and a
// swap composed with an overlapping edit can land at distance k+1
// (OSA("ca", "abc") = 3 after swap+insert).
test("k inserts/deletes/substitutions never exceed distance k", () => {
  const plainEdit = editArb.filter((e) => e.kind !== "swap")
  fc.assert(
    fc.property(str, fc.array(plainEdit, { maxLength: 4 }), (a, edits) => {
      let b = a
      for (const e of edits) {
        b = applyEdit(b, e)
      }
      expect(distance(a, b)).toBeLessThanOrEqual(edits.length)
    })
  )
})

const DID_YOU_MEAN = /Did you mean "([^"]+)"/

// Small alphabet + short names so near-collisions are common.
const ROOT = "/pbt-near-miss"
const shortName = fc.string({
  maxLength: 6,
  minLength: 1,
  unit: fc.constantFrom(..."abcdef"),
})

function diagnosticsForRef(names: string[], refText: string) {
  const ws = new Workspace(pathToFileURL(ROOT).toString())
  for (const name of names) {
    ws.indexFile(
      `${ROOT}/.claude/skills/${name}/SKILL.md`,
      `---\nname: ${name}\n---\n`
    )
  }
  return ws.diagnosticsFor(ws.indexFile(`${ROOT}/.claude/notes.md`, refText))
}

const skillSetAndTarget = fc
  .tuple(fc.uniqueArray(shortName, { maxLength: 6, minLength: 1 }), shortName)
  .filter(
    ([names, target]) =>
      !(names.includes(target) || BUILTIN_COMMANDS.has(target))
  )

test("near-miss warning appears iff the brute-force min distance is ≤ 2, naming a nearest skill", () => {
  fc.assert(
    fc.property(skillSetAndTarget, ([names, target]) => {
      const diags = diagnosticsForRef(names, `See /${target} now\n`)
      const min = Math.min(...names.map((n) => distance(target, n)))
      expect(diags).toHaveLength(1)
      const [diag] = diags
      if (min <= 2) {
        expect(diag.severity).toBe(DiagnosticSeverity.Warning)
        const message =
          typeof diag.message === "string" ? diag.message : diag.message.value
        const suggested = DID_YOU_MEAN.exec(message)?.[1]
        expect(suggested).toBeDefined()
        expect(distance(target, suggested ?? "")).toBe(min)
      } else {
        expect(diag.severity).toBe(DiagnosticSeverity.Information)
      }
    })
  )
})

test("$ tokens warn on near misses but never get the unknown-skill info hint", () => {
  fc.assert(
    fc.property(skillSetAndTarget, ([names, target]) => {
      const diags = diagnosticsForRef(names, `See $${target} now\n`)
      const min = Math.min(...names.map((n) => distance(target, n)))
      if (min <= 2) {
        expect(diags).toHaveLength(1)
        expect(diags[0]?.severity).toBe(DiagnosticSeverity.Warning)
      } else {
        expect(diags).toHaveLength(0)
      }
    })
  )
})
