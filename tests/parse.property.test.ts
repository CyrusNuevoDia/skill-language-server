import { expect, test } from "bun:test"
import fc from "fast-check"
import { fullRange, NAME_PATTERN, parseDoc } from "@/parse"
import { SkillName } from "@/workspace"
import { joinName, segment, sepRun, sigil, skillName } from "./helpers/props"

const NAME_RE = new RegExp(`^${NAME_PATTERN}$`)

// Contexts chosen so the char before the sigil is never in BAD_PREV and the
// char after the name never extends it (and is never `/`).
const safePrefix = fc.constantFrom("", "Use ", "see (", "> ", '"', "* ")
const safeSuffix = fc.constantFrom("", " next", ".", ") end", ", more", "!")

// One representative per character category of BAD_PREV.
const badPrev = fc.constantFrom(..."aZ0_$/:.~-")

test("a sigil + valid name in a safe context yields exactly that token, slicing back to the text", () => {
  fc.assert(
    fc.property(
      skillName,
      sigil,
      safePrefix,
      safeSuffix,
      (name, s, pre, post) => {
        const line = `${pre}${s}${name}${post}`
        const { tokens } = parseDoc(`${line}\n`)
        expect(tokens).toHaveLength(1)
        const [token] = tokens
        expect(token.name).toBe(name)
        expect(token.sigil).toBe(s)
        const { nameRange } = token
        expect(
          line.slice(nameRange.start.character, nameRange.end.character)
        ).toBe(name)
        const full = fullRange(token)
        expect(line.slice(full.start.character, full.end.character)).toBe(
          s + name
        )
      }
    )
  )
})

test("a sigil preceded by any word/path/scheme/home char never tokenizes", () => {
  fc.assert(
    fc.property(skillName, sigil, badPrev, (name, s, bad) => {
      expect(parseDoc(`${bad}${s}${name}\n`).tokens).toHaveLength(0)
    })
  )
})

test("a token followed by a slash is a path, and its tail never tokenizes either", () => {
  fc.assert(
    fc.property(skillName, sigil, segment, (name, s, tail) => {
      expect(parseDoc(`${s}${name}/${tail}\n`).tokens).toHaveLength(0)
    })
  )
})

const fenceMarker = fc
  .tuple(fc.constantFrom("`", "~"), fc.integer({ max: 5, min: 3 }))
  .map(([ch, n]) => ch.repeat(n))
const fenceIndent = fc.string({ maxLength: 3, unit: fc.constant(" ") })

test("no tokens between a fence opener and its first valid closer — LF and CRLF alike", () => {
  fc.assert(
    fc.property(
      fenceMarker,
      fenceIndent,
      fenceIndent,
      fc.constantFrom("", "bash", "js title"),
      skillName,
      skillName,
      fc.integer({ max: 2, min: 0 }),
      fc.constantFrom("\n", "\r\n"),
      (
        marker,
        openIndent,
        closeIndent,
        info,
        fencedName,
        tailName,
        extraLen,
        eol
      ) => {
        const doc = [
          `${openIndent}${marker}${info}`,
          `run /${fencedName} now`,
          `${closeIndent}${marker}${marker[0].repeat(extraLen)}`,
          `Use /${tailName}`,
        ].join(eol)
        const { fenced, tokens } = parseDoc(doc)
        expect(tokens.map((t) => t.name)).toEqual([tailName])
        expect(tokens[0]?.nameRange.start.line).toBe(3)
        expect(fenced).toEqual(new Set([0, 1, 2]))
      }
    )
  )
})

test("a shorter or different-marker closer does not end the fence", () => {
  fc.assert(
    fc.property(
      fenceMarker,
      skillName,
      fc.boolean(),
      (marker, name, flipChar) => {
        const wrong = flipChar
          ? (marker[0] === "`" ? "~" : "`").repeat(6)
          : marker.slice(1)
        const { fenced, tokens } = parseDoc(
          [marker, wrong, `/${name}`].join("\n")
        )
        expect(tokens).toHaveLength(0)
        expect(fenced).toEqual(new Set([0, 1, 2]))
      }
    )
  )
})

const anyLengthName = fc
  .tuple(segment, fc.array(fc.tuple(sepRun, segment), { maxLength: 8 }))
  .map(joinName)

test("constructed-valid names of any length match the grammar and SkillName agrees", () => {
  fc.assert(
    fc.property(anyLengthName, (name) => {
      expect(NAME_RE.test(name)).toBe(true)
      expect(SkillName.allows(name)).toBe(true)
    })
  )
})

test("mutated names — invalid char, leading/trailing separator — are rejected", () => {
  fc.assert(
    fc.property(
      skillName,
      fc.nat(),
      fc.constantFrom(..."ABZ /.!@"),
      (name, pos, ch) => {
        const i = pos % (name.length + 1)
        expect(SkillName.allows(name.slice(0, i) + ch + name.slice(i))).toBe(
          false
        )
      }
    )
  )
  fc.assert(
    fc.property(skillName, sepRun, fc.boolean(), (name, sep, leading) => {
      expect(SkillName.allows(leading ? sep + name : name + sep)).toBe(false)
    })
  )
})

// A character soup dense in sigils, name chars, separators, fences, and
// newlines, so token-bearing shapes come up constantly.
const soup = fc.string({
  maxLength: 60,
  unit: fc.constantFrom(..."/$ab-:_ .`~\n0"),
})

test("every token parsed from arbitrary text matches the grammar and slices back exactly", () => {
  fc.assert(
    fc.property(soup, (text) => {
      const lines = text.split("\n")
      for (const token of parseDoc(text).tokens) {
        expect(NAME_RE.test(token.name)).toBe(true)
        const line = lines[token.nameRange.start.line] ?? ""
        expect(
          line.slice(
            token.nameRange.start.character,
            token.nameRange.end.character
          )
        ).toBe(token.name)
      }
    })
  )
})

// YAML 1.1 (js-yaml via gray-matter) parses these words — and any scalar
// starting with a digit (0x1f, 1_000, 1:2:3) — as non-strings, so declared
// names start with a letter and skip the word list.
const YAML_WORDS = new Set([
  "true",
  "false",
  "yes",
  "no",
  "on",
  "off",
  "null",
  "y",
  "n",
])
const letterSegment = fc
  .tuple(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"),
    fc.string({
      maxLength: 7,
      unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_"),
    })
  )
  .map(([head, tail]) => head + tail)
const declaredName = fc.oneof(
  fc
    .tuple(letterSegment, fc.array(fc.tuple(sepRun, segment), { maxLength: 3 }))
    .map(joinName)
    .filter((name) => !YAML_WORDS.has(name)),
  // Values that also occur inside the literal text "name:" — the anchor must
  // still land after the key, never inside it.
  fc.constantFrom("name", "a", "e", "na", "am")
)

test("frontmatter name range anchors to the value after the key, for bare/quoted/commented shapes", () => {
  fc.assert(
    fc.property(
      declaredName,
      fc.constantFrom("bare", "quoted", "comment"),
      fc.boolean(),
      skillName,
      (name, shape, wrongTyped, refName) => {
        const nameLine =
          shape === "quoted"
            ? `name: "${name}"`
            : shape === "comment"
              ? `name: ${name} # owned by tests`
              : `name: ${name}`
        const extra = wrongTyped ? "description: 42" : "description: real text"
        const text = `---\n${nameLine}\n${extra}\n---\nSee /${refName} now\n`
        const { frontmatter, tokens } = parseDoc(text)
        expect(frontmatter?.name).toBe(name)
        expect(frontmatter?.description).toBe(
          wrongTyped ? undefined : "real text"
        )
        expect(frontmatter?.endLine).toBe(4)
        const range = frontmatter?.nameRange
        expect(range).toBeDefined()
        if (!range) {
          return
        }
        expect(range.start.line).toBe(1)
        expect(range.start.character).toBeGreaterThanOrEqual("name:".length)
        expect(nameLine.slice(range.start.character, range.end.character)).toBe(
          name
        )
        expect(tokens.map((t) => t.name)).toEqual([refName])
        expect(tokens[0]?.nameRange.start.line).toBe(4)
      }
    )
  )
})
