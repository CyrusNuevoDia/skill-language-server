import { type Dirent, readdirSync, readFileSync } from "node:fs"
import { basename, dirname, join, relative, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { minBy } from "es-toolkit"
import ignore, { type Ignore } from "ignore"
import {
  type Diagnostic,
  DiagnosticSeverity,
  type Location,
  type Position,
  type Range,
} from "vscode-languageserver"
import { type Frontmatter, parseDoc, type Token } from "./parse"

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const MAX_NAME_LENGTH = 64

const SCAN_SEGMENTS = new Set([".claude", ".agents", ".codex", "skills"])
/** Agent memory files reference skills from anywhere in the tree. */
const SCAN_BASENAMES = new Set(["CLAUDE.md", "AGENTS.md"])
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"])

export type Skill = {
  folderPath: string
  /** Canonical name = folder basename. */
  name: string
  skillFilePath: string
}

export type FileEntry = {
  /** Line numbers inside fenced code blocks (used by completion). */
  fenced: Set<number>
  frontmatter: Frontmatter | null
  path: string
  /** Set when this file is a `skills/<name>/SKILL.md`. */
  skillFolder?: string
  tokens: Token[]
  uri: string
}

export class Workspace {
  readonly root: string
  /** Keyed by URI. */
  readonly files = new Map<string, FileEntry>()
  /** Keyed by canonical (folder) name; >1 entry means duplicates. */
  readonly skills = new Map<string, Skill[]>()
  /** Patterns from the workspace-root .skillignore, if present. */
  private ignored: Ignore | null

  constructor(rootUri: string) {
    this.root = fileURLToPath(rootUri)
    this.ignored = loadSkillignore(this.root)
  }

  scan(): void {
    this.files.clear()
    this.skills.clear()
    this.ignored = loadSkillignore(this.root)
    for (const path of walk(this.root)) {
      if (path.endsWith(".md") && this.inScope(path)) {
        this.indexFile(path, readFileSync(path, "utf8"))
      }
    }
  }

  inScope(path: string): boolean {
    const rel = relative(this.root, path)
    if (rel.startsWith("..")) {
      return false
    }
    const segments = rel.split(sep)
    if (this.ignored?.ignores(segments.join("/"))) {
      return false
    }
    return (
      segments.some((seg) => SCAN_SEGMENTS.has(seg)) ||
      SCAN_BASENAMES.has(basename(path))
    )
  }

  /** Re-read a file from disk into the index; drops it if unreadable. */
  reindexPath(path: string): FileEntry | null {
    try {
      return this.indexFile(path, readFileSync(path, "utf8"))
    } catch {
      this.removeFile(pathToFileURL(path).toString())
      return null
    }
  }

  removeFile(uri: string): void {
    const entry = this.files.get(uri)
    if (!entry) {
      return
    }
    this.removeSkill(entry)
    this.files.delete(uri)
  }

  indexFile(path: string, text: string): FileEntry {
    const uri = pathToFileURL(path).toString()
    const previous = this.files.get(uri)
    if (previous?.skillFolder) {
      this.removeSkill(previous)
    }

    const { fenced, frontmatter, tokens } = parseDoc(text)
    const entry: FileEntry = { fenced, frontmatter, path, tokens, uri }

    const parent = dirname(path)
    if (
      basename(path) === "SKILL.md" &&
      basename(dirname(parent)) === "skills"
    ) {
      const folder = basename(parent)
      entry.skillFolder = folder
      const skill: Skill = {
        folderPath: parent,
        name: folder,
        skillFilePath: path,
      }
      this.skills.set(skill.name, [
        ...(this.skills.get(skill.name) ?? []),
        skill,
      ])
    }

    this.files.set(uri, entry)
    return entry
  }

  private removeSkill(entry: FileEntry): void {
    const folder = entry.skillFolder
    if (!folder) {
      return
    }
    const list = (this.skills.get(folder) ?? []).filter(
      (s) => s.skillFilePath !== entry.path
    )
    if (list.length === 0) {
      this.skills.delete(folder)
    } else {
      this.skills.set(folder, list)
    }
  }

  skillOf(name: string): Skill | undefined {
    return this.skills.get(name)?.[0]
  }

  /** The SKILL.md file entry backing a skill. */
  entryOf(skill: Skill): FileEntry | undefined {
    return this.files.get(pathToFileURL(skill.skillFilePath).toString())
  }

  /** Location of a skill's definition: the frontmatter `name:` value. */
  definitionOf(skill: Skill): Location {
    const entry = this.entryOf(skill)
    const zero: Range = {
      end: { character: 0, line: 0 },
      start: { character: 0, line: 0 },
    }
    return {
      range: entry?.frontmatter?.nameRange ?? zero,
      uri: pathToFileURL(skill.skillFilePath).toString(),
    }
  }

  /** Every reference (name-part range) to a skill across scanned files. */
  referencesTo(name: string): Location[] {
    const out: Location[] = []
    for (const entry of this.files.values()) {
      for (const token of entry.tokens) {
        if (token.name === name) {
          out.push({ range: token.nameRange, uri: entry.uri })
        }
      }
    }
    return out
  }

  /** The reference token at a position, if any (hit-test includes the sigil). */
  tokenAt(uri: string, pos: Position): Token | undefined {
    return this.files
      .get(uri)
      ?.tokens.find(
        (t) =>
          t.line === pos.line &&
          pos.character >= t.startChar &&
          pos.character <= t.nameRange.end.character
      )
  }

  /** The skill name whose frontmatter `name:` value contains this position. */
  declAt(uri: string, pos: Position): string | undefined {
    const entry = this.files.get(uri)
    const range = entry?.frontmatter?.nameRange
    if (!(entry?.skillFolder && range)) {
      return
    }
    const inRange =
      pos.line === range.start.line &&
      pos.character >= range.start.character &&
      pos.character <= range.end.character
    return inRange ? entry.skillFolder : undefined
  }

  /** Resolve the skill a position points at, via reference token or declaration. */
  skillAt(uri: string, pos: Position): Skill | undefined {
    const token = this.tokenAt(uri, pos)
    if (token) {
      return this.skillOf(token.name)
    }
    const decl = this.declAt(uri, pos)
    return decl ? this.skillOf(decl) : undefined
  }

  diagnosticsFor(entry: FileEntry): Diagnostic[] {
    const out: Diagnostic[] = []

    for (const token of entry.tokens) {
      if (this.skills.has(token.name)) {
        continue
      }
      const near = minBy(
        [...this.skills.keys()].filter((k) => distance(token.name, k) <= 2),
        (k) => distance(token.name, k)
      )
      if (near) {
        out.push({
          message: `Unknown skill "${token.name}". Did you mean "${near}"?`,
          range: token.nameRange,
          severity: DiagnosticSeverity.Warning,
          source: "skill-language-server",
        })
      }
    }

    if (entry.skillFolder && !entry.frontmatter?.nameRange) {
      out.push({
        message: `SKILL.md is missing a frontmatter "name: ${entry.skillFolder}" field.`,
        range: {
          end: { character: 0, line: 0 },
          start: { character: 0, line: 0 },
        },
        severity: DiagnosticSeverity.Error,
        source: "skill-language-server",
      })
    }

    if (entry.skillFolder && entry.frontmatter?.nameRange) {
      const { name, nameRange } = entry.frontmatter
      if (name !== entry.skillFolder) {
        out.push({
          message: `Frontmatter name "${name}" does not match folder name "${entry.skillFolder}".`,
          range: nameRange,
          severity: DiagnosticSeverity.Error,
          source: "skill-language-server",
        })
      }
      const twins = this.skills.get(entry.skillFolder) ?? []
      if (twins.length > 1) {
        const other = twins.find((s) => s.skillFilePath !== entry.path)
        out.push({
          message: `Duplicate skill name "${entry.skillFolder}" — also defined at ${relative(
            this.root,
            other?.skillFilePath ?? ""
          )}.`,
          range: nameRange,
          severity: DiagnosticSeverity.Error,
          source: "skill-language-server",
        })
      }
    }

    return out
  }
}

function loadSkillignore(root: string): Ignore | null {
  try {
    return ignore().add(readFileSync(join(root, ".skillignore"), "utf8"))
  } catch {
    return null
  }
}

function* walk(dir: string): Generator<string> {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) {
        yield* walk(join(dir, e.name))
      }
    } else if (e.isFile()) {
      yield join(dir, e.name)
    }
  }
}

/** Optimal string alignment (Damerau-Levenshtein with adjacent transpositions). */
export function distance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = []
  for (let i = 0; i < rows; i += 1) {
    const row = new Array<number>(cols).fill(0)
    row[0] = i
    d.push(row)
  }
  for (let j = 0; j < cols; j += 1) {
    d[0][j] = j
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[a.length][b.length]
}
