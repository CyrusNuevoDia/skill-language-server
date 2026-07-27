import { regex } from "arkregex"
import { type } from "arktype"
import type { Range } from "vscode-languageserver"
import { parse as parseYAML } from "yaml"

const FrontmatterFields = type({ "description?": "string", "name?": "string" })

export type Frontmatter = typeof FrontmatterFields.infer & {
  /** First line index after the closing `---`. */
  endLine: number
  /** Range of the value of the `name:` field. */
  nameRange?: Range
}

export type Token = {
  line: number
  name: string
  /** Range of the name part only (sigil excluded). */
  nameRange: Range
  sigil: "/" | "$"
  /** Column of the sigil. */
  startChar: number
}

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
const TOKEN = regex(`[/$](${NAME_PATTERN})`, "g")
/** A sigil preceded by any of these is a path segment, URI scheme, shell var, etc. */
export const BAD_PREV = /[A-Za-z0-9_$/:.-]/
const FENCE = /^ {0,3}(```|~~~)/
const NAME_LINE = regex("^name:\\s*(\\S.*?)\\s*$")

export function parseDoc(text: string): ParsedDoc {
  const lines = text.split("\n")
  const frontmatter = parseFrontmatter(lines)

  const tokens: Token[] = []
  const fenced = new Set<number>()
  let inFence = false
  const startLine = frontmatter ? frontmatter.endLine : 0
  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i]
    if (FENCE.test(line)) {
      inFence = !inFence
      fenced.add(i)
      continue
    }
    if (inFence) {
      fenced.add(i)
      continue
    }

    TOKEN.lastIndex = 0
    for (let m = TOKEN.exec(line); m; m = TOKEN.exec(line)) {
      const prev = m.index > 0 ? line[m.index - 1] : ""
      if (prev && BAD_PREV.test(prev)) {
        continue
      }
      if (line[m.index + m[0].length] === "/") {
        continue // path like /usr/bin
      }
      tokens.push({
        line: i,
        name: m[1],
        nameRange: {
          end: { character: m.index + m[0].length, line: i },
          start: { character: m.index + 1, line: i },
        },
        sigil: line[m.index] as "/" | "$",
        startChar: m.index,
      })
    }
  }
  return { fenced, frontmatter, tokens }
}

function parseFrontmatter(lines: string[]): Frontmatter | null {
  if (lines[0]?.trim() !== "---") {
    return null
  }
  let close = -1
  for (let i = 1; i < lines.length; i += 1) {
    const t = lines[i].trim()
    if (t === "---" || t === "...") {
      close = i
      break
    }
  }
  if (close === -1) {
    return null
  }

  let data: unknown = {}
  try {
    data = parseYAML(lines.slice(1, close).join("\n")) ?? {}
  } catch {
    // Malformed YAML: fall through with no fields; diagnostics may cover this later.
  }
  const parsed = FrontmatterFields(data)
  const fields = parsed instanceof type.errors ? {} : parsed

  let nameRange: Range | undefined
  for (let i = 1; i < close; i += 1) {
    const m = NAME_LINE.exec(lines[i])
    if (m) {
      const col = lines[i].indexOf(m[1])
      nameRange = {
        end: { character: col + m[1].length, line: i },
        start: { character: col, line: i },
      }
      break
    }
  }

  return {
    ...fields,
    endLine: close + 1,
    nameRange,
  }
}
