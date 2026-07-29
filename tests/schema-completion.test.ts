import { expect, test } from "bun:test"
import {
  type CompletionItem,
  CompletionItemKind,
} from "vscode-languageserver-protocol"
import { SKILL_SCHEMA } from "@/schema"
import { completionItemsOf, startClient } from "./helpers/harness"

const c = await startClient()
const HTTPS_URL = /^https:\/\//

const UNIVERSAL_FIELDS = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]
const CLAUDE_FIELDS = [
  "when_to_use",
  "argument-hint",
  "arguments",
  "disable-model-invocation",
  "user-invocable",
  "disallowed-tools",
  "model",
  "effort",
  "context",
  "agent",
  "background",
  "hooks",
  "paths",
  "shell",
]
const FINITE_VALUES: Record<string, readonly string[]> = {
  background: ["true", "false"],
  context: ["fork"],
  "disable-model-invocation": ["true", "false"],
  effort: ["low", "medium", "high", "xhigh", "max"],
  shell: ["bash", "powershell"],
  "user-invocable": ["true", "false"],
}

const documentationOf = (item: CompletionItem | undefined): string => {
  if (typeof item?.documentation === "string") {
    return item.documentation
  }
  return item?.documentation?.value ?? ""
}

test("the shared catalog records types, sources, scopes, and finite values", () => {
  expect(SKILL_SCHEMA.map(({ name }) => name)).toEqual([
    ...UNIVERSAL_FIELDS,
    ...CLAUDE_FIELDS,
  ])
  for (const entry of SKILL_SCHEMA) {
    expect(entry.description.length).toBeGreaterThan(0)
    expect(entry.variants.length).toBeGreaterThan(0)
    for (const variant of entry.variants) {
      expect(variant.yamlTypes.length).toBeGreaterThan(0)
      expect(variant.source).toMatch(HTTPS_URL)
      expect(["universal", "claude"]).toContain(variant.scope)
    }
  }
})

test("top-level field completion replaces empty and partial prefixes without snippets", async () => {
  const emptyRel = ".claude/skills/schema-empty/SKILL.md"
  await c.open(emptyRel, "---\n\n---\n\n# Draft\n")
  const empty = completionItemsOf(
    await c.completion(emptyRel, { character: 0, line: 1 })
  )
  expect(empty.map(({ label }) => label)).toEqual([
    ...UNIVERSAL_FIELDS,
    ...CLAUDE_FIELDS,
  ])
  expect(
    empty.every(({ insertTextFormat }) => insertTextFormat === undefined)
  ).toBe(true)
  expect(empty.find(({ label }) => label === "name")).toMatchObject({
    kind: CompletionItemKind.Field,
    label: "name",
    textEdit: {
      newText: "name:",
      range: {
        end: { character: 0, line: 1 },
        start: { character: 0, line: 1 },
      },
    },
  })

  const partialRel = ".claude/skills/schema-partial/SKILL.md"
  await c.open(partialRel, "---\ndis\n---\n")
  const partial = completionItemsOf(
    await c.completion(partialRel, { character: 3, line: 1 })
  )
  expect(
    partial.find(({ label }) => label === "disable-model-invocation")?.textEdit
  ).toEqual({
    newText: "disable-model-invocation:",
    range: {
      end: { character: 3, line: 1 },
      start: { character: 0, line: 1 },
    },
  })
})

test("field completion is client-aware and documents ambiguous scope", async () => {
  for (const rel of [
    ".agents/skills/schema-codex/SKILL.md",
    ".codex/skills/schema-codex/SKILL.md",
  ]) {
    // biome-ignore lint/performance/noAwaitInLoops: protocol cases must remain isolated and ordered
    await c.open(rel, "---\n\n---\n")
    const labels = completionItemsOf(
      await c.completion(rel, { character: 0, line: 1 })
    ).map(({ label }) => label)
    expect(labels).toEqual(UNIVERSAL_FIELDS)
  }

  const ambiguousRel = "shared/skills/schema-shared/SKILL.md"
  await c.open(ambiguousRel, "---\n\n---\n")
  const ambiguous = completionItemsOf(
    await c.completion(ambiguousRel, { character: 0, line: 1 })
  )
  expect(ambiguous.map(({ label }) => label)).toEqual([
    ...UNIVERSAL_FIELDS,
    ...CLAUDE_FIELDS,
  ])
  expect(
    documentationOf(ambiguous.find(({ label }) => label === "effort"))
  ).toContain("Claude Code")
  expect(
    documentationOf(ambiguous.find(({ label }) => label === "name"))
  ).toContain("Agent Skills")
})

test("finite values complete after the colon and replace partial value prefixes", async () => {
  const finite = Object.fromEntries(
    SKILL_SCHEMA.flatMap((entry) =>
      entry.variants.flatMap((variant) =>
        variant.finiteValues
          ? [[entry.name, variant.finiteValues] as const]
          : []
      )
    )
  )
  expect(finite).toEqual(FINITE_VALUES)

  for (const [name, values] of Object.entries(FINITE_VALUES)) {
    const rel = `.claude/skills/value-${name}/SKILL.md`
    const line = `${name}: `
    // biome-ignore lint/performance/noAwaitInLoops: protocol cases must remain isolated and ordered
    await c.open(rel, `---\n${line}\n---\n`)
    const items = completionItemsOf(
      await c.completion(rel, { character: line.length, line: 1 })
    )
    expect(items.map(({ label }) => label)).toEqual([...values])
    expect(items[0]?.kind).toBe(CompletionItemKind.Value)
    expect(items[0]?.textEdit).toEqual({
      newText: values[0],
      range: {
        end: { character: line.length, line: 1 },
        start: { character: line.length, line: 1 },
      },
    })
    expect(documentationOf(items[0])).toContain("Claude Code")
  }

  const partialRel = ".claude/skills/value-partial/SKILL.md"
  await c.open(partialRel, "---\neffort: xh\n---\n")
  const partial = completionItemsOf(
    await c.completion(partialRel, { character: 10, line: 1 })
  )
  expect(partial.map(({ label }) => label)).toEqual([
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ])
  expect(partial.find(({ label }) => label === "xhigh")?.textEdit).toEqual({
    newText: "xhigh",
    range: {
      end: { character: 10, line: 1 },
      start: { character: 8, line: 1 },
    },
  })
})

test("non-finite fields and non-Claude paths do not offer values", async () => {
  const modelRel = ".claude/skills/value-model/SKILL.md"
  await c.open(modelRel, "---\nmodel: \n---\n")
  expect(
    completionItemsOf(await c.completion(modelRel, { character: 7, line: 1 }))
  ).toEqual([])

  const codexRel = ".agents/skills/value-effort/SKILL.md"
  await c.open(codexRel, "---\neffort: \n---\n")
  expect(
    completionItemsOf(await c.completion(codexRel, { character: 8, line: 1 }))
  ).toEqual([])
})

test("schema completion stays in valid top-level SKILL.md frontmatter", async () => {
  const cases = [
    {
      character: 0,
      line: 0,
      rel: ".claude/skills/no-frontmatter/SKILL.md",
      text: "\n# Body\n",
    },
    {
      character: 0,
      line: 4,
      rel: ".claude/skills/body/SKILL.md",
      text: "---\nname: body\n---\n\n\n",
    },
    {
      character: 0,
      line: 5,
      rel: ".claude/skills/fence/SKILL.md",
      text: "---\nname: fence\n---\n\n```\n\n```\n",
    },
    {
      character: 5,
      line: 1,
      rel: ".claude/skills/comment/SKILL.md",
      text: "---\n# dis\n---\n",
    },
    {
      character: 2,
      line: 2,
      rel: ".claude/skills/nested/SKILL.md",
      text: "---\nmetadata:\n  \n---\n",
    },
    {
      character: 0,
      line: 1,
      rel: ".claude/skills/malformed/SKILL.md",
      text: "---\n\nmetadata: [\n---\n",
    },
    {
      character: 0,
      line: 1,
      rel: ".claude/skills/not-skill.md",
      text: "---\n\n---\n",
    },
  ]

  for (const { character, line, rel, text } of cases) {
    // biome-ignore lint/performance/noAwaitInLoops: protocol cases must remain isolated and ordered
    await c.open(rel, text)
    expect(
      completionItemsOf(await c.completion(rel, { character, line }))
    ).toEqual([])
  }
})

test("already-present top-level keys are not offered again", async () => {
  const rel = ".claude/skills/existing/SKILL.md"
  await c.open(rel, "---\nname: existing\neffort: high\n\n---\n")
  const labels = completionItemsOf(
    await c.completion(rel, { character: 0, line: 3 })
  ).map(({ label }) => label)
  expect(labels).not.toContain("name")
  expect(labels).not.toContain("effort")
  expect(labels).toContain("description")
})

test("schema keys have no hover behavior", async () => {
  const rel = ".claude/skills/no-schema-hover/SKILL.md"
  await c.open(rel, "---\neffort: high\n---\n")
  expect(await c.hover(rel, { character: 2, line: 1 })).toBeNull()
})

test("completion capability adds only the schema value trigger", () => {
  expect(c.serverCapabilities.completionProvider).toEqual({
    triggerCharacters: ["/", "$", ":"],
  })
})
