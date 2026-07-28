import { expect, test } from "bun:test"
import fc from "fast-check"
import type { WorkspaceEdit } from "vscode-languageserver-protocol"
import { parseDoc } from "@/parse"
import {
  expectedShippingEdits,
  type RefSpec,
  SHIPPING_DECL,
  SHIPPING_REFS,
} from "./corpus"
import {
  contentOf,
  type FlatEdit,
  posOf,
  renameFilesOf,
  sortByPos,
  startClient,
  textEditsOf,
  uriFor,
} from "./helpers/harness"
import { skillName } from "./helpers/props"

const c = await startClient()

const ORIGINS: RefSpec[] = [...SHIPPING_REFS, SHIPPING_DECL]
const originArb = fc.constantFrom(...ORIGINS)
// Prefixed so a generated name can never collide with a fixture skill.
const newNameArb = skillName.map((name) => `zz-${name}`)

const originPos = (spec: RefSpec, cursor: number) =>
  posOf(spec.rel, spec.needle, {
    occurrence: spec.occurrence,
    // Anywhere in the name, both ends inclusive.
    offset: spec.offset + (cursor % (spec.length + 1)),
  })

test("rename yields the identical corpus edit set from every origin and cursor offset", async () => {
  await fc.assert(
    fc.asyncProperty(
      originArb,
      fc.nat(),
      newNameArb,
      async (spec, cursor, newName) => {
        const we = (await c.rename(
          spec.rel,
          originPos(spec, cursor),
          newName
        )) as WorkspaceEdit
        expect(renameFilesOf(we)).toEqual([
          {
            newUri: uriFor(`.claude/skills/${newName}`),
            oldUri: uriFor(".claude/skills/shipping"),
          },
        ])
        expect(textEditsOf(we)).toEqual(
          sortByPos(expectedShippingEdits(newName))
        )
      }
    ),
    { numRuns: 30 }
  )
})

test("renaming to the current name is a no-op from any origin", async () => {
  await fc.assert(
    fc.asyncProperty(originArb, fc.nat(), async (spec, cursor) => {
      expect(
        await c.rename(spec.rel, originPos(spec, cursor), "shipping")
      ).toBeNull()
    }),
    { numRuns: 15 }
  )
})

/** All ranges are single-line and non-overlapping; apply back-to-front. */
function applyEdits(text: string, edits: FlatEdit[]): string {
  const lines = text.split("\n")
  const ordered = [...edits].toSorted(
    (x, y) =>
      y.range.start.line - x.range.start.line ||
      y.range.start.character - x.range.start.character
  )
  for (const e of ordered) {
    const line = lines[e.range.start.line] ?? ""
    lines[e.range.start.line] =
      line.slice(0, e.range.start.character) +
      e.newText +
      line.slice(e.range.end.character)
  }
  return lines.join("\n")
}

test("applying the rename edits and re-parsing shows every reference renamed", async () => {
  await fc.assert(
    fc.asyncProperty(newNameArb, async (newName) => {
      const we = (await c.rename(
        ".claude/CLAUDE.md",
        posOf(".claude/CLAUDE.md", "/shipping", { offset: 3 }),
        newName
      )) as WorkspaceEdit
      const edits = textEditsOf(we)
      for (const rel of new Set(ORIGINS.map((s) => s.rel))) {
        const patched = applyEdits(
          contentOf(rel),
          edits.filter((e) => e.uri === uriFor(rel))
        )
        const parsed = parseDoc(patched)
        const refsHere = SHIPPING_REFS.filter((s) => s.rel === rel).length
        expect(parsed.tokens.filter((t) => t.name === newName)).toHaveLength(
          refsHere
        )
        expect(parsed.tokens.some((t) => t.name === "shipping")).toBe(false)
        if (rel === SHIPPING_DECL.rel) {
          expect(parsed.frontmatter?.name).toBe(newName)
        }
      }
    }),
    { numRuns: 15 }
  )
})
