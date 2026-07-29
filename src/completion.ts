import { basename } from "node:path"
import { regex } from "arkregex"
import { attempt, uniq } from "es-toolkit"
import matter from "gray-matter"
import {
  type CompletionItem,
  CompletionItemKind,
  type Position,
} from "vscode-languageserver"
import {
  clientForSkillPath,
  type SkillSchemaEntry,
  type SkillSchemaVariant,
  schemaEntriesForClient,
  schemaVariantsForClient,
} from "@/schema"
import { rangeIn } from "@/utils"

const FIELD_PREFIX = /^[a-z0-9_-]*$/
const VALUE_PREFIX = regex("^([a-z0-9_-]+):[ \t]*([a-z0-9_-]*)$")
const MATTER_OPTIONS = {}

export function schemaCompletions(
  text: string,
  path: string,
  position: Position
): CompletionItem[] | null {
  if (basename(path) !== "SKILL.md") {
    return null
  }
  const lines = text
    .split("\n")
    .map((textLine) =>
      textLine.endsWith("\r") ? textLine.slice(0, -1) : textLine
    )
  const closingLine = frontmatterClosingLine(lines)
  if (
    closingLine === null ||
    position.line <= 0 ||
    position.line >= closingLine
  ) {
    return null
  }

  const line = lines[position.line] ?? ""
  if (position.character > line.length) {
    return []
  }
  const beforeCursor = line.slice(0, position.character)
  const afterCursor = line.slice(position.character)
  const mapping = frontmatterMapping(lines.with(position.line, ""), closingLine)
  if (!mapping) {
    return null
  }
  if (afterCursor.trim() !== "" || beforeCursor.trimStart() !== beforeCursor) {
    return []
  }

  const client = clientForSkillPath(path)
  const valueMatch = VALUE_PREFIX.exec(beforeCursor)
  if (valueMatch) {
    const [, name, typed] = valueMatch
    const entry = schemaEntriesForClient(client).find(
      (candidate) => candidate.name === name
    )
    if (!(entry && frontmatterMapping(lines, closingLine))) {
      return []
    }
    const variants = schemaVariantsForClient(entry, client).filter(
      ({ finiteValues }) => finiteValues !== undefined
    )
    const values = uniq(
      variants.flatMap(({ finiteValues }) => finiteValues ?? [])
    )
    const start = position.character - typed.length
    return values.map((value) => ({
      documentation: documentationFor(entry, variants),
      filterText: value,
      kind: CompletionItemKind.Value,
      label: value,
      textEdit: {
        newText: value,
        range: rangeIn(position.line, start, position.character),
      },
    }))
  }

  if (!FIELD_PREFIX.test(beforeCursor)) {
    return []
  }
  const existing = new Set(Object.keys(mapping))
  return schemaEntriesForClient(client)
    .filter(({ name }) => !existing.has(name))
    .map((entry) => ({
      documentation: documentationFor(
        entry,
        schemaVariantsForClient(entry, client)
      ),
      filterText: entry.name,
      kind: CompletionItemKind.Field,
      label: entry.name,
      textEdit: {
        newText: `${entry.name}:`,
        range: rangeIn(position.line, 0, position.character),
      },
    }))
}

function frontmatterClosingLine(lines: string[]): number | null {
  if (lines[0] !== "---") {
    return null
  }
  for (let line = 1; line < lines.length; line += 1) {
    if (lines[line] === "---") {
      return line
    }
  }
  return null
}

function frontmatterMapping(
  lines: string[],
  closingLine: number
): Record<string, unknown> | null {
  const source = lines.slice(0, closingLine + 1).join("\n")
  const [, file] = attempt(() => matter(source, MATTER_OPTIONS))
  const data = file?.data
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null
}

function documentationFor(
  entry: SkillSchemaEntry,
  variants: readonly SkillSchemaVariant[]
): { kind: "markdown"; value: string } {
  const scopes = uniq(
    variants.map(({ scope }) =>
      scope === "universal" ? "Agent Skills (universal)" : "Claude Code"
    )
  )
  const sources = uniq(
    variants.map(
      ({ scope, source }) =>
        `[${scope === "universal" ? "Agent Skills specification" : "Claude Code documentation"}](${source})`
    )
  )
  return {
    kind: "markdown",
    value: `${entry.description}\n\n**Scope:** ${scopes.join(", ")}\n\n**Source:** ${sources.join(", ")}`,
  }
}
