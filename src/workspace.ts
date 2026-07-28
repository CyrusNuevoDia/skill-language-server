import type { Dirent } from "node:fs"
import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { basename, dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { type } from "arktype"
import { attemptAsync } from "es-toolkit"
import ignore, { type Ignore } from "ignore"
import {
  type Diagnostic,
  DiagnosticSeverity,
  type Location,
  type Position,
  type Range,
} from "vscode-languageserver"
import { BUILTIN_COMMANDS } from "./builtins"
import {
  type Frontmatter,
  fullRange,
  NAME_PATTERN,
  parseDoc,
  type Token,
} from "./parse"
import { containsPos, distance, uriOf, ZERO_RANGE } from "./utils"

/** Full-string variant of the token grammar, plus the length cap for renames. */
export const SkillName = type(new RegExp(`^${NAME_PATTERN}$`)).atMostLength(64)
export type SkillName = typeof SkillName.infer

const SCAN_SEGMENTS = new Set([".claude", ".agents", ".codex", "skills"])
/** Agent memory files reference skills from anywhere in the tree. */
const SCAN_BASENAMES = new Set(["CLAUDE.md", "AGENTS.md"])
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"])

/** Max edit distance for a "did you mean" near-miss suggestion. */
const NEAR_MISS_DISTANCE = 2
/** Unknown token name → nearest skill name within the threshold (null = none). */
type NearMissMemo = Map<string, string | null>

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
  /** Patterns from the workspace-root .skillignore; loaded by scan(). */
  private ignored: Ignore | null = null

  constructor(rootUri: string) {
    this.root = fileURLToPath(rootUri)
  }

  async scan(): Promise<void> {
    this.files.clear()
    this.skills.clear()
    this.ignored = await loadSkillignore(this.root)

    for await (const path of walk(this.root)) {
      if (path.endsWith(".md") && this.inScope(path)) {
        await this.reindexPath(path)
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
  async reindexPath(path: string): Promise<FileEntry | null> {
    try {
      return this.indexFile(path, await readFile(path, "utf8"))
    } catch {
      this.removeFile({ uri: uriOf(path) })
      return null
    }
  }

  removeFile({ uri }: { uri: string }): FileEntry | null {
    const entry = this.files.get(uri)
    if (!entry) {
      return null
    }
    this.removeSkill(entry)
    this.files.delete(uri)
    return entry
  }

  /** Drop every indexed file at or under a filesystem path (folder deletes arrive as one event). */
  removeUnder(path: string): FileEntry[] {
    return [...this.files.values()]
      .filter((f) => f.path === path || f.path.startsWith(path + sep))
      .map(this.removeFile.bind(this))
      .filter(Boolean)
  }

  indexFile(path: string, text: string): FileEntry {
    const uri = uriOf(path)
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
    return this.files.get(uriOf(skill.skillFilePath))
  }

  /** Location of a skill's definition: the frontmatter `name:` value. */
  definitionOf(skill: Skill): Location {
    return {
      range: this.entryOf(skill)?.frontmatter?.nameRange ?? ZERO_RANGE,
      uri: uriOf(skill.skillFilePath),
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
      ?.tokens.find((t) => containsPos(fullRange(t), pos))
  }

  /** The skill declaration (frontmatter `name:` value) containing this position. */
  declAt(
    uri: string,
    pos: Position
  ): { name: string; range: Range } | undefined {
    const entry = this.files.get(uri)
    const range = entry?.frontmatter?.nameRange
    if (!(entry?.skillFolder && range && containsPos(range, pos))) {
      return
    }
    return { name: entry.skillFolder, range }
  }

  /** Resolve the skill a position points at, via reference token or declaration. */
  skillAt(uri: string, pos: Position): Skill | undefined {
    const token = this.tokenAt(uri, pos)
    if (token) {
      return this.skillOf(token.name)
    }
    const decl = this.declAt(uri, pos)
    if (!decl) {
      return
    }
    // From a declaration, resolve the twin defined in THIS file — never a
    // same-named duplicate elsewhere in the workspace.
    return this.skills
      .get(decl.name)
      ?.find((s) => uriOf(s.skillFilePath) === uri)
  }

  /** Names defined as custom commands: `.claude/commands/<name>.md` or `.codex/prompts/<name>.md`. */
  private commandNames(): Set<string> {
    const out = new Set<string>()
    for (const { path } of this.files.values()) {
      const parent = basename(dirname(path))
      const grandparent = basename(dirname(dirname(path)))
      if (
        (parent === "commands" && grandparent === ".claude") ||
        (parent === "prompts" && grandparent === ".codex")
      ) {
        out.add(basename(path, ".md"))
      }
    }
    return out
  }

  diagnosticsFor(
    entry: FileEntry,
    commands = this.commandNames(),
    nearMisses: NearMissMemo = new Map()
  ): Diagnostic[] {
    return [
      ...this.referenceDiagnostics(entry, commands, nearMisses),
      ...this.declarationDiagnostics(entry),
    ]
  }

  /** Diagnostics for every indexed file, sharing one command-name and near-miss pass. */
  diagnosticsByURI(): Map<string, Diagnostic[]> {
    const commands = this.commandNames()
    const nearMisses: NearMissMemo = new Map()
    return new Map(
      [...this.files.values()].map((entry) => [
        entry.uri,
        this.diagnosticsFor(entry, commands, nearMisses),
      ])
    )
  }

  /**
   * Nearest skill name within edit distance {@link NEAR_MISS_DISTANCE}, or
   * null. Memoizable across a whole diagnostics pass because the skill set
   * doesn't change mid-pass; keyed on the token name alone (sigil affects
   * which diagnostic is emitted, never the nearest name).
   */
  private nearestSkillName(target: string, memo: NearMissMemo): string | null {
    const cached = memo.get(target)
    if (cached !== undefined) {
      return cached
    }
    let best: string | null = null
    let bestDistance = NEAR_MISS_DISTANCE + 1
    for (const name of this.skills.keys()) {
      // A length gap beyond the threshold bounds the distance above it.
      if (Math.abs(name.length - target.length) > NEAR_MISS_DISTANCE) {
        continue
      }
      const d = distance(target, name)
      if (d < bestDistance) {
        best = name
        bestDistance = d
        if (d === 1) {
          break // 0 is impossible for an unknown name; 1 can't be beaten
        }
      }
    }
    memo.set(target, best)
    return best
  }

  private referenceDiagnostics(
    entry: FileEntry,
    commands: Set<string>,
    nearMisses: NearMissMemo
  ): Diagnostic[] {
    const out: Diagnostic[] = []

    for (const token of entry.tokens) {
      if (this.skills.has(token.name)) {
        continue
      }
      if (
        token.sigil === "/" &&
        (BUILTIN_COMMANDS.has(token.name) || commands.has(token.name))
      ) {
        continue // a command, not a skill — never diagnosed
      }
      const near = this.nearestSkillName(token.name, nearMisses)
      if (near) {
        out.push({
          message: `Unknown skill "${token.name}". Did you mean "${near}"?`,
          range: token.nameRange,
          severity: DiagnosticSeverity.Warning,
          source: "skill-language-server",
        })
      } else if (token.sigil === "/") {
        // Dollar tokens stay quiet: prose like `$5` or `$my_var` matches the
        // grammar, and an info hint on every one would drown real signal.
        out.push({
          message: `Unknown skill "${token.name}".`,
          range: token.nameRange,
          severity: DiagnosticSeverity.Information,
          source: "skill-language-server",
        })
      }
    }
    return out
  }

  private declarationDiagnostics(entry: FileEntry): Diagnostic[] {
    if (!entry.skillFolder) {
      return []
    }
    const { name, nameRange } = entry.frontmatter ?? {}
    if (!nameRange) {
      return [
        {
          message: `SKILL.md is missing a frontmatter "name: ${entry.skillFolder}" field.`,
          range: ZERO_RANGE,
          severity: DiagnosticSeverity.Error,
          source: "skill-language-server",
        },
      ]
    }

    const out: Diagnostic[] = []
    if (name !== entry.skillFolder) {
      out.push({
        message: `Frontmatter name "${name}" does not match folder name "${entry.skillFolder}".`,
        range: nameRange,
        severity: DiagnosticSeverity.Error,
        source: "skill-language-server",
      })
    }
    const twin = (this.skills.get(entry.skillFolder) ?? []).find(
      (s) => s.skillFilePath !== entry.path
    )
    if (twin) {
      out.push({
        message: `Duplicate skill name "${entry.skillFolder}" — also defined at ${relative(
          this.root,
          twin.skillFilePath
        )}.`,
        range: nameRange,
        severity: DiagnosticSeverity.Error,
        source: "skill-language-server",
      })
    }
    return out
  }
}

async function loadSkillignore(root: string): Promise<Ignore | null> {
  const [, loaded] = await attemptAsync(async () =>
    ignore().add(await readFile(join(root, ".skillignore"), "utf8"))
  )
  return loaded
}

async function* walk(
  dir: string,
  ancestors = new Set<string>()
): AsyncGenerator<string> {
  // The cycle guard keys on real paths of the directories currently being
  // walked, so a symlink loop terminates no matter which side it is entered
  // from — but a dir merely reachable twice (symlink + direct path) is
  // walked via both routes. Yielded paths stay symlink-side.
  const [, real] = await attemptAsync(() => realpath(dir))
  if (real === null || ancestors.has(real)) {
    return
  }
  const [, entries] = await attemptAsync(() =>
    readdir(dir, { withFileTypes: true })
  )
  if (entries === null) {
    return
  }
  ancestors.add(real)
  for (const e of entries) {
    const path = join(dir, e.name)
    // biome-ignore lint/performance/noAwaitInLoops: the ancestor-chain cycle guard requires sequential depth-first order
    const kind = await kindOf(e, path)
    if (kind === DirKind && !SKIP_DIRS.has(e.name)) {
      yield* walk(path, ancestors)
    } else if (kind === FileKind) {
      yield path
    }
  }
  ancestors.delete(real)
}

const DirKind = Symbol("DirKind")
const FileKind = Symbol("FileKind")

/** Entry kind, following symlinks; broken links are neither dir nor file. */
async function kindOf(
  entry: Dirent,
  path: string
): Promise<typeof DirKind | typeof FileKind | null> {
  if (entry.isSymbolicLink()) {
    const [, s] = await attemptAsync(() => stat(path))
    if (s === null) {
      return null
    }
    if (s.isDirectory()) {
      return DirKind
    }
    return s.isFile() ? FileKind : null
  }
  if (entry.isDirectory()) {
    return DirKind
  }
  return entry.isFile() ? FileKind : null
}
