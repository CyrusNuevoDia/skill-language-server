import { regex } from "arkregex"
import { attempt } from "es-toolkit"
import matter from "gray-matter"
import type { Range } from "vscode-languageserver"
import { rangeIn } from "@/utils"

type FrontmatterFields = {
  description?: string
  name?: string
}

export type Frontmatter = FrontmatterFields & {
  /** First line index after the closing `---`. */
  endLine: number
  /** Range of the value of the `name:` field. */
  nameRange?: Range
}

export type Token = {
  name: string
  /** Range of the name part only (sigil excluded). */
  nameRange: Range
  sigil: "/" | "$"
}

/** The token's range including its sigil (for hit-tests, links, highlights). */
export const fullRange = (token: Token): Range =>
  rangeIn(
    token.nameRange.start.line,
    token.nameRange.start.character - 1,
    token.nameRange.end.character
  )

export type ParsedDoc = {
  /** Line numbers inside (or delimiting) fenced code blocks. */
  fenced: Set<number>
  frontmatter: Frontmatter | null
  tokens: Token[]
}

// Name = [a-z0-9_] segments joined by runs of "-" or ":" — separators can
// repeat (a::b, x--y) but never lead or trail, so "/ship:" in prose keeps
// its colon.
export const NAME_PATTERN = "[a-z0-9_]+(?:[-:]+[a-z0-9_]+)*"
/** A sigil preceded by any of these is a path segment, URI scheme, shell var, home dir, etc. */
export const BAD_PREV = /[A-Za-z0-9_$/:.~-]/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
/** A closing fence: marker only, nothing after but whitespace. */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const NAME_LINE = regex("^name:\\s*(\\S.*?)\\s*$")

// Exists solely so every matter() call passes an options object: gray-matter
// memoizes results in an unbounded module-level cache keyed on the raw input
// string, and skips that cache only when options are present — without this,
// a server reparsing on every keystroke leaks every buffer state ever seen.
const MATTER_OPTIONS = {}

/** Per CommonMark, only a closer with the same marker char and at least the opening length ends a fence. */
const closesFence = (line: string, opening: string): boolean =>
  FENCE_CLOSE.exec(line)?.[1].startsWith(opening) === true

export function parseDoc(text: string): ParsedDoc {
  // CRLF documents must scan like LF ones: a trailing \r would make the
  // $-anchored FENCE_CLOSE (and NAME_LINE) miss, leaving fences unclosed.
  // Tokens are unaffected — \r can only trail, past any token's range.
  const lines = text
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
  const frontmatter = parseFrontmatter(text, lines)

  const tokens: Token[] = []
  const fenced = new Set<number>()
  let fence: string | null = null
  const startLine = frontmatter ? frontmatter.endLine : 0
  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i]
    if (fence) {
      fenced.add(i)
      if (closesFence(line, fence)) {
        fence = null
      }
      continue
    }
    const { 1: opened } = FENCE.exec(line) ?? []
    if (opened) {
      fence = opened
      fenced.add(i)
      continue
    }

    scanTokens(line, i, tokens)
  }
  return { fenced, frontmatter, tokens }
}

function scanTokens(line: string, lineNo: number, tokens: Token[]): void {
  // Constructed per call: the `g` flag makes a regex stateful (lastIndex), so
  // a shared instance would leak position state across calls.
  const token = regex(`([/$])(${NAME_PATTERN})`, "g")
  for (let m = token.exec(line); m; m = token.exec(line)) {
    const prev = m.index > 0 ? line[m.index - 1] : ""
    if (prev && BAD_PREV.test(prev)) {
      continue
    }
    if (line[m.index + m[0].length] === "/") {
      continue // path like /usr/bin
    }
    const { 1: sigil, 2: name } = m
    tokens.push({
      name,
      nameRange: rangeIn(lineNo, m.index + 1, m.index + m[0].length),
      sigil,
    })
  }
}

function parseFrontmatter(text: string, lines: string[]): Frontmatter | null {
  // matter() throws on malformed YAML (js-yaml errors propagate) and on a
  // `---foo` first line naming an unregistered engine: either way that's a
  // doc without usable frontmatter, not an error.
  const [, file] = attempt(() => matter(text, MATTER_OPTIONS))
  if (!file) {
    return null
  }

  // endLine is positional and stays ours: gray-matter reports only the
  // frontmatter/content split, so count the lines it consumed as frontmatter.
  const consumed = text.slice(0, text.length - file.content.length)
  let endLine = consumed.split("\n").length - 1
  if (file.content === "" && consumed !== "" && !consumed.endsWith("\n")) {
    endLine += 1 // the closing delimiter is an unterminated final line
  }
  if (endLine === 0) {
    return null // gray-matter consumed nothing: no frontmatter
  }

  const fields = fieldsOf(file.data)

  let nameRange: Range | undefined
  for (let i = 1; i < endLine && i < lines.length; i += 1) {
    const m = NAME_LINE.exec(lines[i])
    if (m) {
      // Anchor to the YAML-parsed value when it appears verbatim, so quotes
      // and trailing comments stay outside the range; else the raw capture.
      // Search past the key: a short value ("name: a", "name: name") also
      // occurs inside the literal text "name:" itself.
      const keyEnd = "name:".length
      const value =
        fields.name && lines[i].includes(fields.name, keyEnd)
          ? fields.name
          : m[1]
      const col = lines[i].indexOf(value, keyEnd)
      nameRange = rangeIn(i, col, col + value.length)
      break
    }
  }

  return {
    ...fields,
    endLine,
    nameRange,
  }
}

/** Salvage fields one by one: a wrong-typed field must not erase the others. */
function fieldsOf(data: unknown): FrontmatterFields {
  if (typeof data !== "object" || data === null) {
    return {}
  }
  const record = data as Record<string, unknown>
  const fields: FrontmatterFields = {}
  if (typeof record.name === "string") {
    fields.name = record.name
  }
  if (typeof record.description === "string") {
    fields.description = record.description
  }
  return fields
}
