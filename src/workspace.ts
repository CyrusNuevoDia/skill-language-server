import type { Dirent } from "node:fs"
import { readdir, readFile, realpath, stat } from "node:fs/promises"
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path"
import { fileURLToPath } from "node:url"
import { regex } from "arkregex"
import { attemptAsync } from "es-toolkit"
import ignore, { type Ignore } from "ignore"
import {
  type Diagnostic,
  DiagnosticSeverity,
  type Location,
  type Position,
  type Range,
} from "vscode-languageserver"
import { BUILTIN_COMMANDS } from "@/builtins"
import { SkillName } from "@/grammar"
import {
  type Frontmatter,
  type FrontmatterField,
  type FrontmatterIssue,
  fullRange,
  type MarkdownLink,
  parseDoc,
  type Token,
  type XMLIssue,
} from "@/parse"
import {
  clientForSkillPath,
  schemaEntriesForClient,
  schemaVariantsForClient,
  type YAMLType,
} from "@/schema"
import { containsPos, distance, uriOf, ZERO_RANGE } from "@/utils"

const SCAN_SEGMENTS = new Set([".claude", ".agents", ".codex", "skills"])
/** Agent memory files reference skills from anywhere in the tree. */
const SCAN_BASENAMES = new Set(["CLAUDE.md", "AGENTS.md"])
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"])

/** Max edit distance for a "did you mean" near-miss suggestion. */
const NEAR_MISS_DISTANCE = 2
const DESTINATION_SUFFIX = /[?#]/
const URI_SCHEME = regex("^[A-Za-z][A-Za-z0-9+.-]*:")
const MARKDOWN_ESCAPE = regex(
  "\\\\([!\"#$%&'()*+,./:;<=>?@[\\\\\\]^_`{|}~-])",
  "g"
)
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
  frontmatterIssues: FrontmatterIssue[]
  links: MarkdownLink[]
  path: string
  /** Set when this file is a `skills/<name>/SKILL.md`. */
  skillFolder?: string
  tokens: Token[]
  uri: string
  xmlIssues: XMLIssue[]
}

export type SkillReference =
  | {
      kind: "markdown-link"
      link: MarkdownLink
      name: string
      /** Skill-name path segment; this is the rename/reference edit range. */
      nameRange: Range
      /** Whole inline link, used for position hit-testing. */
      range: Range
    }
  | {
      kind: "sigil"
      name: string
      nameRange: Range
      /** Sigil plus name, used for position hit-testing and highlighting. */
      range: Range
      token: Token
    }

export type LinkRepair = {
  newText: string
  range: Range
  title: string
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

    const { fenced, frontmatter, frontmatterIssues, links, tokens, xmlIssues } =
      parseDoc(text)
    const entry: FileEntry = {
      fenced,
      frontmatter,
      frontmatterIssues,
      links,
      path,
      tokens,
      uri,
      xmlIssues,
    }

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

  /** Every reference (skill-name edit range) across scanned files. */
  referencesTo(name: string): Location[] {
    const out: Location[] = []
    for (const entry of this.files.values()) {
      for (const reference of this.skillReferences(entry)) {
        if (reference.name === name) {
          out.push({ range: reference.nameRange, uri: entry.uri })
        }
      }
    }
    return out
  }

  /** Resolved sigil and Markdown-link references in one syntax-explicit API. */
  skillReferences(entry: FileEntry): SkillReference[] {
    const sigils: SkillReference[] = entry.tokens
      .filter((token) => this.skills.has(token.name))
      .map((token) => ({
        kind: "sigil",
        name: token.name,
        nameRange: token.nameRange,
        range: fullRange(token),
        token,
      }))
    const links = entry.links
      .map((link) => this.skillReferenceForLink(entry, link))
      .filter((reference) => reference !== null)
    return [...sigils, ...links]
  }

  /** Resolved reference containing a position; Markdown hit-tests include visible prose. */
  referenceAt(uri: string, pos: Position): SkillReference | undefined {
    const entry = this.files.get(uri)
    return entry
      ? this.skillReferences(entry).find((reference) =>
          containsPos(reference.range, pos)
        )
      : undefined
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
    const reference = this.referenceAt(uri, pos)
    if (reference) {
      return this.skillOf(reference.name)
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

  async repairForLinkDiagnostic(
    uri: string,
    range: Range
  ): Promise<LinkRepair | null> {
    const entry = this.files.get(uri)
    const link = entry?.links.find((candidate) =>
      rangesEqual(candidate.destinationRange, range)
    )
    if (!(entry && link)) {
      return null
    }
    const parts = localDestination(link.destination)
    if (!parts) {
      return null
    }

    const corrected = await caseCorrection(dirname(entry.path), parts.path)
    if (corrected) {
      const replacement = preservePathEncoding(parts.rawPath, corrected)
      return {
        newText: replacement,
        range: pathRange(link, parts.rawPath.length),
        title: `Change destination to "${replacement}"`,
      }
    }

    const target = resolve(dirname(entry.path), parts.path)
    const parent = dirname(target)
    const [, parentStat] = await attemptAsync(() => stat(parent))
    if (!(parentStat?.isDirectory() ?? false)) {
      return null
    }
    const [, siblings] = await attemptAsync(() =>
      readdir(parent, { withFileTypes: true })
    )
    if (!siblings) {
      return null
    }
    const wanted = basename(target)
    const wantedExtension = extname(wanted)
    const matches = siblings.filter(
      ({ name }) =>
        extname(name) === wantedExtension &&
        distance(wanted, name) <= NEAR_MISS_DISTANCE
    )
    if (matches.length !== 1) {
      return null
    }
    const rawWanted = parts.rawPath.slice(parts.rawPath.lastIndexOf("/") + 1)
    const replacement = rawWanted.includes("%")
      ? encodeURIComponent(matches[0].name)
      : matches[0].name
    return {
      newText: replacement,
      range: finalSegmentRange(link, parts.rawPath),
      title: `Change destination to "${replacement}"`,
    }
  }

  private skillReferenceForLink(
    entry: FileEntry,
    link: MarkdownLink
  ): SkillReference | null {
    const parts = localDestination(link.destination)
    if (!parts) {
      return null
    }
    const destination = resolve(dirname(entry.path), parts.path)
    const matched = [...this.skills.values()]
      .flat()
      .find(
        (skill) =>
          destination === skill.folderPath ||
          destination === skill.skillFilePath
      )
    if (!matched) {
      return null
    }
    const segment = skillSegment(link, parts.path)
    return segment
      ? {
          kind: "markdown-link",
          link,
          name: matched.name,
          nameRange: segment,
          range: link.range,
        }
      : null
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
      ...this.frontmatterDiagnostics(entry),
      ...this.declarationDiagnostics(entry),
      ...this.diagnosticsForXML(entry),
    ]
  }

  async diagnosticsForDocument(entry: FileEntry): Promise<Diagnostic[]> {
    return [
      ...this.diagnosticsFor(entry),
      ...(await this.linkDiagnostics(entry)),
    ]
  }

  /** Diagnostics for every indexed file, sharing one command-name and near-miss pass. */
  async diagnosticsByURI(): Promise<Map<string, Diagnostic[]>> {
    const commands = this.commandNames()
    const nearMisses: NearMissMemo = new Map()
    return new Map(
      await Promise.all(
        [...this.files.values()].map(async (entry) => {
          const diagnostics: Diagnostic[] = [
            ...this.diagnosticsFor(entry, commands, nearMisses),
            ...(await this.linkDiagnostics(entry)),
          ]
          return [entry.uri, diagnostics] as const
        })
      )
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

  private async linkDiagnostics(entry: FileEntry): Promise<Diagnostic[]> {
    const diagnostics = await Promise.all(
      entry.links.map(async (link): Promise<Diagnostic | null> => {
        const parts = localDestination(link.destination)
        if (!parts) {
          return null
        }
        const caseMismatch = await caseCorrection(
          dirname(entry.path),
          parts.path
        )
        const [, destination] = await attemptAsync(() =>
          stat(resolve(dirname(entry.path), parts.path))
        )
        return destination && !caseMismatch
          ? null
          : {
              code: "broken-markdown-link",
              message: `Local link destination "${link.destination}" does not exist.`,
              range: link.destinationRange,
              severity: DiagnosticSeverity.Warning,
              source: "skill-language-server",
            }
      })
    )
    return diagnostics.filter((diagnostic) => diagnostic !== null)
  }

  private declarationDiagnostics(entry: FileEntry): Diagnostic[] {
    if (!entry.skillFolder) {
      return []
    }

    const out: Diagnostic[] = []
    const { name, nameRange } = entry.frontmatter ?? {}
    if (name !== undefined && name !== entry.skillFolder) {
      out.push({
        message: `Frontmatter name "${name}" does not match folder name "${entry.skillFolder}".`,
        range: nameRange ?? ZERO_RANGE,
        severity: DiagnosticSeverity.Error,
        source: "skill-language-server",
      })
    }
    if (!SkillName.allows(entry.skillFolder)) {
      out.push({
        message: `Skill folder name "${entry.skillFolder}" has invalid canonical skill-name syntax.`,
        range: ZERO_RANGE,
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
        range: nameRange ?? ZERO_RANGE,
        severity: DiagnosticSeverity.Error,
        source: "skill-language-server",
      })
    }
    return out
  }

  private frontmatterDiagnostics(entry: FileEntry): Diagnostic[] {
    if (!entry.skillFolder) {
      return []
    }
    const out: Diagnostic[] = entry.frontmatterIssues.map((issue) => ({
      message: issue.message,
      range: issue.range,
      severity: DiagnosticSeverity.Error,
      source: "skill-language-server",
    }))
    const fields = entry.frontmatter?.fields ?? []
    return [
      ...out,
      ...duplicateKeyDiagnostics(fields),
      ...fieldTypeDiagnostics(entry.path, fields),
      ...requiredFieldDiagnostics(fields),
      ...requiredStringDiagnostics(fields),
    ]
  }

  private diagnosticsForXML(entry: FileEntry): Diagnostic[] {
    return entry.xmlIssues.map((issue) => ({
      message:
        issue.kind === "unclosed"
          ? `Unclosed tag "<${issue.name}>".`
          : issue.kind === "unmatched"
            ? `Closing tag "</${issue.name}>" has no matching opener.`
            : `Closing tag "</${issue.name}>" does not match open tag "<${issue.openName}>".`,
      range: issue.range,
      severity: DiagnosticSeverity.Error,
      source: "skill-language-server",
    }))
  }
}

const errorDiagnostic = (message: string, range: Range): Diagnostic => ({
  message,
  range,
  severity: DiagnosticSeverity.Error,
  source: "skill-language-server",
})

function duplicateKeyDiagnostics(fields: FrontmatterField[]): Diagnostic[] {
  const seen = new Set<string>()
  const out: Diagnostic[] = []
  for (const field of fields) {
    if (seen.has(field.key)) {
      out.push(
        errorDiagnostic(
          `Duplicate top-level frontmatter key "${field.key}".`,
          field.keyRange
        )
      )
    }
    seen.add(field.key)
  }
  return out
}

function fieldTypeDiagnostics(
  path: string,
  fields: FrontmatterField[]
): Diagnostic[] {
  const client = clientForSkillPath(path)
  const out: Diagnostic[] = []
  for (const schemaEntry of schemaEntriesForClient(client)) {
    const accepted = new Set<YAMLType>(
      schemaVariantsForClient(schemaEntry, client).flatMap(
        ({ yamlTypes }) => yamlTypes
      )
    )
    for (const field of fields.filter(({ key }) => key === schemaEntry.name)) {
      if (!accepted.has(field.yamlType as YAMLType)) {
        out.push(
          errorDiagnostic(
            `Frontmatter field "${field.key}" must be ${[...accepted].join(
              " or "
            )}, not ${field.yamlType}.`,
            field.range
          )
        )
      }
    }
  }
  return out
}

function requiredFieldDiagnostics(fields: FrontmatterField[]): Diagnostic[] {
  const present = new Set(fields.map(({ key }) => key))
  return ["name", "description"]
    .filter((required) => !present.has(required))
    .map((required) =>
      errorDiagnostic(
        `SKILL.md is missing required frontmatter field "${required}".`,
        ZERO_RANGE
      )
    )
}

function requiredStringDiagnostics(fields: FrontmatterField[]): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const field of fields) {
    if (
      (field.key === "name" || field.key === "description") &&
      typeof field.value === "string" &&
      field.value.trim() === ""
    ) {
      out.push(
        errorDiagnostic(
          `Frontmatter field "${field.key}" must not be empty or whitespace-only.`,
          field.range
        )
      )
    }
    if (
      field.key === "name" &&
      typeof field.value === "string" &&
      field.value.trim() !== "" &&
      !SkillName.allows(field.value)
    ) {
      out.push(
        errorDiagnostic(
          `Frontmatter name "${field.value}" has invalid canonical skill-name syntax.`,
          field.range
        )
      )
    }
  }
  return out
}

type LocalDestination = {
  path: string
  rawPath: string
}

function localDestination(destination: string): LocalDestination | null {
  const suffixAt = destination.search(DESTINATION_SUFFIX)
  const rawPath = suffixAt === -1 ? destination : destination.slice(0, suffixAt)
  if (ignoredDestinationPath(rawPath)) {
    return null
  }
  const unescaped = rawPath.replace(MARKDOWN_ESCAPE, "$1")
  try {
    const path = decodeURIComponent(unescaped)
    return ignoredDestinationPath(path) ? null : { path, rawPath }
  } catch {
    return ignoredDestinationPath(unescaped)
      ? null
      : { path: unescaped, rawPath }
  }
}

function ignoredDestinationPath(path: string): boolean {
  return (
    path === "" ||
    path.startsWith("#") ||
    path.startsWith("//") ||
    path.startsWith("~/") ||
    isAbsolute(path) ||
    URI_SCHEME.test(path)
  )
}

function preservePathEncoding(rawPath: string, correctedPath: string): string {
  const rawSegments = rawPath.split("/")
  const correctedSegments = correctedPath.split("/")
  return correctedSegments
    .map((segment, index) => {
      const raw = rawSegments[index] ?? segment
      if (!raw.includes("%")) {
        return segment
      }
      try {
        return decodeURIComponent(raw) === segment
          ? raw
          : encodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join("/")
}

function skillSegment(link: MarkdownLink, decodedPath: string): Range | null {
  const parts = localDestination(link.destination)
  if (!parts) {
    return null
  }
  const rawSegments = parts.rawPath.split("/")
  while (rawSegments.at(-1) === "") {
    rawSegments.pop()
  }
  const decodedSegments = decodedPath.split("/")
  while (decodedSegments.at(-1) === "") {
    decodedSegments.pop()
  }
  const segmentIndex =
    decodedSegments.at(-1) === "SKILL.md"
      ? rawSegments.length - 2
      : rawSegments.length - 1
  if (segmentIndex < 0) {
    return null
  }
  const before = rawSegments.slice(0, segmentIndex).join("/")
  const start =
    link.destinationRange.start.character + before.length + (before ? 1 : 0)
  return {
    end: {
      character: start + rawSegments[segmentIndex].length,
      line: link.destinationRange.start.line,
    },
    start: { character: start, line: link.destinationRange.start.line },
  }
}

function pathRange(link: MarkdownLink, rawPathLength: number): Range {
  return {
    end: {
      character: link.destinationRange.start.character + rawPathLength,
      line: link.destinationRange.start.line,
    },
    start: link.destinationRange.start,
  }
}

function finalSegmentRange(link: MarkdownLink, rawPath: string): Range {
  const slash = rawPath.lastIndexOf("/")
  const start = link.destinationRange.start.character + slash + 1
  return {
    end: {
      character: link.destinationRange.start.character + rawPath.length,
      line: link.destinationRange.start.line,
    },
    start: { character: start, line: link.destinationRange.start.line },
  }
}

function rangesEqual(a: Range, b: Range): boolean {
  return (
    a.start.line === b.start.line &&
    a.start.character === b.start.character &&
    a.end.line === b.end.line &&
    a.end.character === b.end.character
  )
}

async function caseCorrection(
  fromDirectory: string,
  authoredPath: string
): Promise<string | null> {
  const segments = authoredPath.split("/")
  const corrected: string[] = []
  let directory = fromDirectory
  let changed = false
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      corrected.push(segment)
      continue
    }
    if (segment === "..") {
      corrected.push(segment)
      directory = dirname(directory)
      continue
    }
    // biome-ignore lint/performance/noAwaitInLoops: each segment resolves relative to the case-corrected parent before it
    const [, entries] = await attemptAsync(() => readdir(directory))
    if (!entries) {
      return null
    }
    const exact = entries.find((entry) => entry === segment)
    const insensitive = entries.filter(
      (entry) => entry.toLowerCase() === segment.toLowerCase()
    )
    const match = exact ?? (insensitive.length === 1 ? insensitive[0] : null)
    if (!match) {
      return null
    }
    corrected.push(match)
    changed ||= match !== segment
    directory = join(directory, match)
  }
  return changed ? corrected.join("/") : null
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
