import type { Location } from "vscode-languageserver-protocol"
import { type FlatEdit, rangeOf, uriFor } from "./harness"

/**
 * Ground truth for the fixture workspace: every reference to `shipping` the
 * server must know about. `offset` = where the name starts inside the needle
 * (skipping the sigil); ranges cover the name part only.
 */
export type RefSpec = {
  length: number
  needle: string
  occurrence?: number
  offset: number
  rel: string
}

export const SHIPPING_REFS: RefSpec[] = [
  {
    length: 8,
    needle: "/shipping",
    occurrence: 1,
    offset: 1,
    rel: ".claude/skills/billing/SKILL.md",
  },
  {
    length: 8,
    needle: "/shipping",
    occurrence: 2,
    offset: 1,
    rel: ".claude/skills/billing/SKILL.md",
  },
  { length: 8, needle: "/shipping", offset: 1, rel: ".claude/CLAUDE.md" },
  {
    length: 8,
    needle: "$shipping",
    offset: 1,
    rel: ".claude/agents/reviewer.md",
  },
  { length: 8, needle: "/shipping", offset: 1, rel: ".agents/notes.md" },
  {
    length: 8,
    needle: "/shipping",
    offset: 1,
    rel: "docs/skills/deploy/SKILL.md",
  },
]

export const SHIPPING_DECL: RefSpec = {
  length: 8,
  needle: "name: shipping",
  offset: 6,
  rel: ".claude/skills/shipping/SKILL.md",
}

export const BILLING_REFS: RefSpec[] = [
  {
    length: 7,
    needle: "$billing",
    occurrence: 1,
    offset: 1,
    rel: ".claude/skills/shipping/SKILL.md",
  },
  { length: 7, needle: "/billing", offset: 1, rel: ".codex/AGENTS.md" },
]

export function locOf(spec: RefSpec): Location {
  return {
    range: rangeOf(spec.rel, spec.needle, {
      length: spec.length,
      occurrence: spec.occurrence,
      offset: spec.offset,
    }),
    uri: uriFor(spec.rel),
  }
}

export function editOf(spec: RefSpec, newText: string): FlatEdit {
  return { ...locOf(spec), newText }
}

/** All text edits a rename of `shipping` must produce (references + frontmatter). */
export function expectedShippingEdits(newName: string): FlatEdit[] {
  return [
    ...SHIPPING_REFS.map((s) => editOf(s, newName)),
    editOf(SHIPPING_DECL, newName),
  ]
}
