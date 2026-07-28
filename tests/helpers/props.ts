import fc from "fast-check"

// Structured generators for the skill-name grammar: building names from
// segments and separator runs (instead of a regex arbitrary) keeps every
// shrunk counterexample inside the grammar, so failures stay readable.

export const SEGMENT_CHARS = [..."abcdefghijklmnopqrstuvwxyz0123456789_"]

export const segment = fc.string({
  maxLength: 8,
  minLength: 1,
  unit: fc.constantFrom(...SEGMENT_CHARS),
})

/** A run of `-`/`:` separators — repeatable and mixable, per the grammar. */
export const sepRun = fc.string({
  maxLength: 3,
  minLength: 1,
  unit: fc.constantFrom("-", ":"),
})

export const joinName = ([head, rest]: [string, [string, string][]]): string =>
  head + rest.map(([sep, seg]) => sep + seg).join("")

/** Grammar-valid by construction. */
export const skillName = fc
  .tuple(segment, fc.array(fc.tuple(sepRun, segment), { maxLength: 3 }))
  .map(joinName)

export const sigil = fc.constantFrom("/" as const, "$" as const)
