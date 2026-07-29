import { regex } from "arkregex"
import { attempt } from "es-toolkit"
import matter from "gray-matter"
import type { Range } from "vscode-languageserver"
import {
  isMap,
  isScalar,
  type Pair,
  type ParsedNode,
  parseDocument,
} from "yaml"
import { createSkillTokenPattern, REFERENCE_BAD_PREV } from "@/grammar"
import { rangeIn } from "@/utils"

export type FrontmatterField = {
  key: string
  keyRange: Range
  range: Range
  value: unknown
  yamlType: string
}

export type FrontmatterIssue = {
  kind: "malformed" | "missing" | "unclosed"
  message: string
  range: Range
}

export type Frontmatter = {
  description?: string
  /** First line index after the closing `---`. */
  endLine: number
  fields: FrontmatterField[]
  name?: string
  /** Range of the value of the `name:` field. */
  nameRange?: Range
}

export type Token = {
  name: string
  /** Range of the name part only (sigil excluded). */
  nameRange: Range
  sigil: "/" | "$"
}

export type MarkdownLink = {
  /** Destination exactly as authored, excluding optional angle brackets. */
  destination: string
  destinationRange: Range
  /** Full inline-link range, from `[` through the closing `)`. */
  range: Range
}

export type XMLIssue = {
  kind: "mismatched" | "unclosed" | "unmatched"
  name: string
  range: Range
  /** Present when a closer mismatches the currently open tag. */
  openName?: string
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
  frontmatterIssues: FrontmatterIssue[]
  links: MarkdownLink[]
  tokens: Token[]
  xmlIssues: XMLIssue[]
}

const FENCE_MARKER_PATTERN = "(`{3,}|~{3,})"
const FENCE = regex(`^ {0,3}${FENCE_MARKER_PATTERN}`)
/** A closing fence: marker only, nothing after but whitespace. */
const FENCE_CLOSE = regex(`^ {0,3}${FENCE_MARKER_PATTERN}[ \t]*$`)
const LINK_SPACE = /\s/
const LINK_SPACE_TAB = /[ \t]/
const URI_AUTOLINK = regex("^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\\s<>]*$")
const XML_NAME_CHARACTER = /[A-Za-z0-9_.:-]/
const XML_NAME_START = /[A-Za-z_:]/
const XML_WHITESPACE = /\s/
const VOID_HTML_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
])

// Exists solely so every matter() call passes an options object: gray-matter
// memoizes results in an unbounded module-level cache keyed on the raw input
// string, and skips that cache only when options are present — without this,
// a server reparsing on every keystroke leaks every buffer state ever seen.
const MATTER_OPTIONS = {
  engines: {
    yaml: {
      parse: (source: string) => ({ source }),
    },
  },
}

/** Per CommonMark, only a closer with the same marker char and at least the opening length ends a fence. */
const closesFence = (line: string, opening: string): boolean =>
  FENCE_CLOSE.exec(line)?.[1].startsWith(opening) === true

export function parseDoc(text: string): ParsedDoc {
  // CRLF documents must scan like LF ones: a trailing \r would make the
  // $-anchored FENCE_CLOSE miss, leaving fences unclosed.
  // Tokens are unaffected — \r can only trail, past any token's range.
  const lines = text
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
  const { frontmatter, issues: frontmatterIssues } = parseFrontmatter(
    text,
    lines
  )

  const links: MarkdownLink[] = []
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

    scanLinks(line, i, links)
    scanTokens(line, i, tokens)
  }
  return {
    fenced,
    frontmatter,
    frontmatterIssues,
    links,
    tokens,
    xmlIssues: scanXMLIssues(lines, fenced, startLine),
  }
}

type XMLTag = {
  kind: "close" | "open" | "selfClosing"
  name: string
  range: Range
}

function scanXMLIssues(
  lines: string[],
  fenced: Set<number>,
  startLine: number
): XMLIssue[] {
  const source = lines.join("\n")
  const lineStarts = lineStartsOf(lines)
  const ignored = ignoredXMLRanges(source, lineStarts, fenced, startLine)
  const tags: XMLTag[] = []

  for (
    let offset = lineStarts[startLine] ?? source.length;
    offset < source.length;
  ) {
    if (ignored[offset] || source[offset] !== "<") {
      offset += 1
      continue
    }
    const parsed = parseXMLTagAt(source, offset, lineStarts)
    if (!parsed) {
      offset += 1
      continue
    }
    offset = parsed.end
    if (parsed.tag) {
      tags.push(parsed.tag)
    }
  }

  return balanceXMLTags(tags)
}

function balanceXMLTags(tags: XMLTag[]): XMLIssue[] {
  const issues: XMLIssue[] = []
  const stack: XMLTag[] = []
  const suppressedUnclosed = new Set<XMLTag>()
  for (const tag of tags) {
    if (tag.kind === "selfClosing") {
      continue
    }
    if (tag.kind === "open") {
      stack.push(tag)
      continue
    }

    const current = stack.at(-1)
    if (!current) {
      issues.push({ kind: "unmatched", name: tag.name, range: tag.range })
      continue
    }
    if (current.name === tag.name) {
      stack.pop()
      continue
    }

    issues.push({
      kind: "mismatched",
      name: tag.name,
      openName: current.name,
      range: tag.range,
    })
    const matching = stack.findLastIndex((open) => open.name === tag.name)
    if (matching === -1) {
      // Keep the current opener available for a later correct closer, but do
      // not also call it unclosed solely because this closer was mismatched.
      suppressedUnclosed.add(current)
    } else {
      // The closer also necessarily closes every intervening malformed nest.
      // Drop them together so one mismatch does not cascade into EOF errors.
      stack.length = matching
    }
  }

  issues.push(
    ...stack
      .filter((open) => !suppressedUnclosed.has(open))
      .map(({ name, range }) => ({
        kind: "unclosed" as const,
        name,
        range,
      }))
  )
  return issues
}

function lineStartsOf(lines: string[]): number[] {
  const starts = [0]
  for (let i = 0; i < lines.length - 1; i += 1) {
    starts.push(starts[i] + lines[i].length + 1)
  }
  return starts
}

function ignoredXMLRanges(
  source: string,
  lineStarts: number[],
  fenced: Set<number>,
  startLine: number
): Uint8Array {
  const ignored = new Uint8Array(source.length)
  const bodyOffset = lineStarts[startLine] ?? source.length
  ignored.fill(1, 0, bodyOffset)
  for (const line of fenced) {
    ignored.fill(1, lineStarts[line], lineStarts[line + 1] ?? source.length)
  }

  for (let offset = bodyOffset; offset < source.length; ) {
    if (ignored[offset] || source[offset] !== "`") {
      offset += 1
      continue
    }
    const runLength = markerRunLength(source, offset, "`")
    const closer = inlineCodeCloser(
      source,
      ignored,
      offset + runLength,
      runLength
    )
    if (closer === -1) {
      offset += runLength
      continue
    }
    const end = closer + runLength
    ignored.fill(1, offset, end)
    offset = end
  }
  return ignored
}

function inlineCodeCloser(
  source: string,
  ignored: Uint8Array,
  from: number,
  openingLength: number
): number {
  for (let offset = from; offset < source.length; ) {
    if (ignored[offset]) {
      return -1
    }
    if (source[offset] !== "`") {
      offset += 1
      continue
    }
    const length = markerRunLength(source, offset, "`")
    if (length === openingLength) {
      return offset
    }
    offset += length
  }
  return -1
}

function markerRunLength(
  source: string,
  offset: number,
  marker: string
): number {
  let end = offset + 1
  while (source[end] === marker) {
    end += 1
  }
  return end - offset
}

function parseXMLTagAt(
  source: string,
  start: number,
  lineStarts: number[]
): { end: number; tag: XMLTag | null } | null {
  const autolink = markdownAutolinkAt(source, start)
  if (autolink) {
    return autolink
  }
  if (source.startsWith("<!--", start)) {
    return terminatedMarkup(source, start, "-->")
  }
  if (source.startsWith("<![CDATA[", start)) {
    return terminatedMarkup(source, start, "]]>")
  }
  if (source.startsWith("<?", start)) {
    return terminatedMarkup(source, start, "?>")
  }
  if (source.startsWith("<!", start)) {
    return declarationAt(source, start)
  }

  const closing = source[start + 1] === "/"
  const nameStart = start + (closing ? 2 : 1)
  if (!isXMLNameStart(source[nameStart])) {
    return null
  }
  let nameEnd = nameStart + 1
  while (isXMLNameCharacter(source[nameEnd])) {
    nameEnd += 1
  }
  if (!isTagBoundary(source[nameEnd])) {
    return null
  }

  const end = tagEnd(source, nameEnd)
  if (end === -1) {
    return null
  }
  if (closing && source.slice(nameEnd, end - 1).trim() !== "") {
    return null
  }

  const name = source.slice(nameStart, nameEnd)
  const selfClosing =
    !closing &&
    (source
      .slice(nameEnd, end - 1)
      .trimEnd()
      .endsWith("/") ||
      VOID_HTML_ELEMENTS.has(name.toLowerCase()))
  return {
    end,
    tag: {
      kind: closing ? "close" : selfClosing ? "selfClosing" : "open",
      name,
      range: rangeFromLineOffsets(lineStarts, nameStart, nameEnd),
    },
  }
}

function markdownAutolinkAt(
  source: string,
  start: number
): { end: number; tag: null } | null {
  const close = source.indexOf(">", start + 1)
  if (close === -1) {
    return null
  }
  const destination = source.slice(start + 1, close)
  return URI_AUTOLINK.test(destination) ? { end: close + 1, tag: null } : null
}

function terminatedMarkup(
  source: string,
  start: number,
  terminator: string
): { end: number; tag: null } | null {
  const at = source.indexOf(terminator, start + 2)
  return at === -1 ? null : { end: at + terminator.length, tag: null }
}

function declarationAt(
  source: string,
  start: number
): { end: number; tag: null } | null {
  let quote: "'" | '"' | null = null
  let subsetDepth = 0
  for (let offset = start + 2; offset < source.length; offset += 1) {
    const character = source[offset]
    if (quote) {
      if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
    } else if (character === "[") {
      subsetDepth += 1
    } else if (character === "]" && subsetDepth > 0) {
      subsetDepth -= 1
    } else if (character === ">" && subsetDepth === 0) {
      return { end: offset + 1, tag: null }
    }
  }
  return null
}

function tagEnd(source: string, from: number): number {
  let quote: "'" | '"' | null = null
  for (let offset = from; offset < source.length; offset += 1) {
    const character = source[offset]
    if (quote) {
      if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
    } else if (character === ">") {
      return offset + 1
    }
  }
  return -1
}

const isXMLNameStart = (character: string | undefined): boolean =>
  character !== undefined && XML_NAME_START.test(character)

const isXMLNameCharacter = (character: string | undefined): boolean =>
  character !== undefined && XML_NAME_CHARACTER.test(character)

const isTagBoundary = (character: string | undefined): boolean =>
  character === undefined ||
  character === ">" ||
  character === "/" ||
  XML_WHITESPACE.test(character)

function rangeFromLineOffsets(
  lineStarts: number[],
  start: number,
  end: number
): Range {
  const line = lineStarts.findLastIndex((offset) => offset <= start)
  return rangeIn(line, start - lineStarts[line], end - lineStarts[line])
}

function scanLinks(line: string, lineNo: number, links: MarkdownLink[]): void {
  const codeSpans = inlineCodeSpans(line)
  for (let start = 0; start < line.length; start += 1) {
    if (
      line[start] !== "[" ||
      isEscaped(line, start) ||
      line[start - 1] === "!" ||
      inside(start, codeSpans)
    ) {
      continue
    }
    const labelEnd = findLabelEnd(line, start + 1, codeSpans)
    if (labelEnd === null || line[labelEnd + 1] !== "(") {
      continue
    }
    const parsed = parseLinkDestination(line, labelEnd + 2)
    if (!parsed) {
      continue
    }
    links.push({
      destination: line.slice(parsed.destinationStart, parsed.destinationEnd),
      destinationRange: rangeIn(
        lineNo,
        parsed.destinationStart,
        parsed.destinationEnd
      ),
      range: rangeIn(lineNo, start, parsed.close + 1),
    })
    start = parsed.close
  }
}

type ParsedLinkDestination = {
  close: number
  destinationEnd: number
  destinationStart: number
}

function parseLinkDestination(
  line: string,
  afterOpen: number
): ParsedLinkDestination | null {
  const at = skipWhitespace(line, afterOpen)
  return line[at] === "<"
    ? parseAngleDestination(line, at)
    : parseBareDestination(line, at)
}

function parseAngleDestination(
  line: string,
  start: number
): ParsedLinkDestination | null {
  const end = findUnescaped(line, ">", start + 1)
  if (end === null || line.slice(start + 1, end).includes("<")) {
    return null
  }
  const close = linkCloseAfter(line, end + 1)
  return close === null
    ? null
    : { close, destinationEnd: end, destinationStart: start + 1 }
}

function parseBareDestination(
  line: string,
  destinationStart: number
): ParsedLinkDestination | null {
  let at = destinationStart
  if (line[at] === "<") {
    return null
  }

  let depth = 0
  while (at < line.length) {
    const character = line[at]
    if (character === "\\" && at + 1 < line.length) {
      at += 2
      continue
    }
    if (character === "(") {
      depth += 1
    } else if (character === ")") {
      if (depth === 0) {
        return {
          close: at,
          destinationEnd: at,
          destinationStart,
        }
      }
      depth -= 1
    } else if (LINK_SPACE.test(character)) {
      const close = linkCloseAfter(line, at)
      return close === null
        ? null
        : { close, destinationEnd: at, destinationStart }
    }
    at += 1
  }
  return null
}

function linkCloseAfter(line: string, afterDestination: number): number | null {
  let at = skipWhitespace(line, afterDestination)
  if (line[at] === ")") {
    return at
  }
  const delimiter = line[at]
  const closer = delimiter === "(" ? ")" : delimiter
  if (!(delimiter === '"' || delimiter === "'" || delimiter === "(")) {
    return null
  }
  at += 1
  while (at < line.length) {
    if (line[at] === "\\" && at + 1 < line.length) {
      at += 2
      continue
    }
    if (line[at] === closer) {
      at = skipWhitespace(line, at + 1)
      return line[at] === ")" ? at : null
    }
    at += 1
  }
  return null
}

function findLabelEnd(
  line: string,
  start: number,
  codeSpans: [number, number][]
): number | null {
  let depth = 0
  for (let at = start; at < line.length; at += 1) {
    if (inside(at, codeSpans)) {
      continue
    }
    if (line[at] === "\\" && at + 1 < line.length) {
      at += 1
    } else if (line[at] === "[") {
      depth += 1
    } else if (line[at] === "]") {
      if (depth === 0) {
        return at
      }
      depth -= 1
    }
  }
  return null
}

function inlineCodeSpans(line: string): [number, number][] {
  const spans: [number, number][] = []
  for (let at = 0; at < line.length; at += 1) {
    if (line[at] !== "`") {
      continue
    }
    const opening = markerRunLength(line, at, "`")
    for (let close = at + opening; close < line.length; close += 1) {
      if (line[close] !== "`") {
        continue
      }
      const closing = markerRunLength(line, close, "`")
      if (closing === opening) {
        spans.push([at, close + closing])
        at = close + closing - 1
        break
      }
      close += closing - 1
    }
  }
  return spans
}

const inside = (at: number, spans: [number, number][]): boolean =>
  spans.some(([start, end]) => at >= start && at < end)

function isEscaped(line: string, at: number): boolean {
  let slashes = 0
  for (let i = at - 1; i >= 0 && line[i] === "\\"; i -= 1) {
    slashes += 1
  }
  return slashes % 2 === 1
}

function findUnescaped(
  line: string,
  needle: string,
  start: number
): number | null {
  for (let at = start; at < line.length; at += 1) {
    if (line[at] === needle && !isEscaped(line, at)) {
      return at
    }
  }
  return null
}

function skipWhitespace(line: string, start: number): number {
  let at = start
  while (at < line.length && LINK_SPACE_TAB.test(line[at])) {
    at += 1
  }
  return at
}

function scanTokens(line: string, lineNo: number, tokens: Token[]): void {
  const token = createSkillTokenPattern()
  for (let m = token.exec(line); m; m = token.exec(line)) {
    const prev = m.index > 0 ? line[m.index - 1] : ""
    if (prev && REFERENCE_BAD_PREV.test(prev)) {
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

function parseFrontmatter(
  text: string,
  lines: string[]
): { frontmatter: Frontmatter | null; issues: FrontmatterIssue[] } {
  const [, file] = attempt(() => matter(text, MATTER_OPTIONS))
  if (!file) {
    return {
      frontmatter: null,
      issues: [
        {
          kind: "malformed",
          message: "SKILL.md frontmatter must be YAML.",
          range: rangeIn(0, 0, lines[0]?.length ?? 0),
        },
      ],
    }
  }

  const consumed = text.slice(0, text.length - file.content.length)
  let endLine = consumed.split("\n").length - 1
  if (file.content === "" && consumed !== "" && !consumed.endsWith("\n")) {
    endLine += 1
  }
  if (endLine === 0) {
    return {
      frontmatter: null,
      issues: [
        {
          kind: "missing",
          message: "SKILL.md is missing YAML frontmatter.",
          range: rangeIn(0, 0, lines[0]?.length ?? 0),
        },
      ],
    }
  }

  const source =
    typeof file.data.source === "string" ? file.data.source : file.matter
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: false,
    version: "1.1",
  })
  const fields = frontmatterFields(document.contents, source, text)
  const issues: FrontmatterIssue[] = document.errors.map(
    ({ message, pos }) => ({
      kind: "malformed",
      message: `Malformed YAML frontmatter: ${message}`,
      range: documentRange(text, 3 + pos[0], 3 + pos[1]),
    })
  )
  if (!text.slice(3).includes("\n---")) {
    issues.unshift({
      kind: "unclosed",
      message: 'YAML frontmatter is missing its closing "---" delimiter.',
      range: rangeIn(0, 0, 3),
    })
  }

  const name = fields.find(
    (field) => field.key === "name" && typeof field.value === "string"
  )
  const description = fields.find(
    (field) => field.key === "description" && typeof field.value === "string"
  )
  return {
    frontmatter: {
      description: description?.value as string | undefined,
      endLine,
      fields,
      name: name?.value as string | undefined,
      nameRange: name?.range,
    },
    issues,
  }
}

function frontmatterFields(
  contents: ParsedNode | null,
  source: string,
  text: string
): FrontmatterField[] {
  if (!isMap(contents)) {
    return []
  }
  const fields: FrontmatterField[] = []
  for (const pair of contents.items) {
    if (!(isScalar(pair.key) && typeof pair.key.value === "string")) {
      continue
    }
    const keyRange = pair.key.range
    if (!keyRange) {
      continue
    }
    const value = pair.value?.toJSON() ?? null
    const valueOffsets = YAMLValueOffsets(pair, source)
    fields.push({
      key: pair.key.value,
      keyRange: documentRange(text, 3 + keyRange[0], 3 + keyRange[1]),
      range: documentRange(text, 3 + valueOffsets[0], 3 + valueOffsets[1]),
      value,
      yamlType: YAMLTypeOf(value),
    })
  }
  return fields
}

function YAMLValueOffsets(
  pair: Pair<ParsedNode, ParsedNode | null>,
  source: string
): [number, number] {
  if (
    pair.value &&
    typeof pair.value === "object" &&
    "range" in pair.value &&
    Array.isArray(pair.value.range)
  ) {
    let [start, end] = pair.value.range as number[]
    const authored = source.slice(start, end)
    if (
      isScalar(pair.value) &&
      typeof pair.value.value === "string" &&
      ((authored.startsWith('"') && authored.endsWith('"')) ||
        (authored.startsWith("'") && authored.endsWith("'")))
    ) {
      start += 1
      end -= 1
    }
    return [start, end]
  }
  const keyEnd = pair.key.range?.[1] ?? 0
  const colon = source.indexOf(":", keyEnd)
  const point = colon === -1 ? keyEnd : colon + 1
  return [point, point]
}

function YAMLTypeOf(value: unknown): string {
  if (Array.isArray(value)) {
    return "sequence"
  }
  if (value !== null && typeof value === "object") {
    return "mapping"
  }
  return value === null ? "null" : typeof value
}

function documentRange(text: string, start: number, end: number): Range {
  return {
    end: positionAt(text, end),
    start: positionAt(text, start),
  }
}

function positionAt(text: string, offset: number): Range["start"] {
  let line = 0
  let lineStart = 0
  for (let i = 0; i < offset; i += 1) {
    if (text[i] === "\n") {
      line += 1
      lineStart = i + 1
    }
  }
  return { character: offset - lineStart, line }
}
