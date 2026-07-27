import type { Range } from "vscode-languageserver"
import { parse as parseYAML } from "yaml"

export type Frontmatter = {
  description?: string
  /** First line index after the closing `---`. */
  endLine: number
  name?: string
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
  frontmatter: Frontmatter | null
  tokens: Token[]
}

const TOKEN = /[/$]([a-z0-9][a-z0-9-]*)/g
/** A sigil preceded by any of these is a path segment, shell var, etc. */
const BAD_PREV = /[A-Za-z0-9_$/.-]/
const FENCE = /^ {0,3}(```|~~~)/
const NAME_LINE = /^name:\s*(\S.*?)\s*$/

export function parseDoc(text: string): ParsedDoc {
  const lines = text.split("\n")
  const frontmatter = parseFrontmatter(lines)

  const tokens: Token[] = []
  let inFence = false
  const startLine = frontmatter ? frontmatter.endLine : 0
  for (let i = startLine; i < lines.length; i += 1) {
    const line = lines[i]
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
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
  return { frontmatter, tokens }
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

  let data: Record<string, unknown> = {}
  try {
    data = parseYAML(lines.slice(1, close).join("\n")) ?? {}
  } catch {
    // Malformed YAML: fall through with no fields; diagnostics may cover this later.
  }

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
    description:
      typeof data.description === "string" ? data.description : undefined,
    endLine: close + 1,
    name: typeof data.name === "string" ? data.name : undefined,
    nameRange,
  }
}
