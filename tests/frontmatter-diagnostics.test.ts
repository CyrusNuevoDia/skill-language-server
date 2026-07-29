import { expect, test } from "bun:test"
import type { Diagnostic } from "vscode-languageserver-protocol"
import { SKILL_SCHEMA, type YAMLType } from "@/schema"
import { startClient } from "./helpers/harness"

const c = await startClient()
const SHIPPING = ".claude/skills/shipping/SKILL.md"

async function diagnosticsWith(
  text: string,
  rel = SHIPPING
): Promise<Diagnostic[]> {
  const uri = c.uriFor(rel)
  c.diagnostics.delete(uri)
  await c.open(rel, text)
  await c.settle()
  const diagnostics = c.diagnostics.get(uri) ?? []
  await c.close(rel)
  await c.settle()
  return diagnostics
}

const messages = (diagnostics: Diagnostic[]) =>
  diagnostics.map(({ message }) => message)

test("missing, malformed, and unclosed frontmatter are diagnosed while salvageable fields survive", async () => {
  const missing = await diagnosticsWith("# no frontmatter\n")
  expect(messages(missing)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("missing YAML frontmatter"),
      expect.stringContaining('"name"'),
      expect.stringContaining('"description"'),
    ])
  )

  const malformed = await diagnosticsWith(
    "---\nname: shipping\nbroken: [unclosed\ndescription: still present\n---\n"
  )
  expect(messages(malformed)).toEqual([
    expect.stringContaining("Malformed YAML frontmatter"),
  ])

  const unclosed = await diagnosticsWith(
    "---\nname: shipping\ndescription: Still present\n"
  )
  expect(messages(unclosed)).toEqual([
    expect.stringContaining('closing "---" delimiter'),
  ])
})

test("missing, empty, and whitespace-only required strings are distinct", async () => {
  const missing = await diagnosticsWith("---\nname: shipping\n---\n")
  expect(messages(missing)).toContain(
    'SKILL.md is missing required frontmatter field "description".'
  )

  for (const [field, value] of [
    ["name", '""'],
    ["name", '"   "'],
    ["description", '""'],
    ["description", '"   "'],
  ] as const) {
    const name = field === "name" ? `${field}: ${value}` : "name: shipping"
    const description =
      field === "description" ? `${field}: ${value}` : "description: valid"
    // biome-ignore lint/performance/noAwaitInLoops: one protocol client must apply buffer states sequentially
    const diagnostics = await diagnosticsWith(
      `---\n${name}\n${description}\n---\n`
    )
    expect(messages(diagnostics)).toContain(
      `Frontmatter field "${field}" must not be empty or whitespace-only.`
    )
  }
})

const YAML_VALUES: Record<YAMLType, string> = {
  boolean: "true",
  mapping: "\n  key: value",
  sequence: "\n  - item",
  string: "value",
}

function frontmatterFor(field: string, value: string): string {
  const name = field === "name" ? `name: ${value}` : "name: shipping"
  const description =
    field === "description"
      ? `description: ${value}`
      : "description: Valid description"
  const extra =
    field === "name" || field === "description" ? "" : `\n${field}: ${value}`
  return `---\n${name}\n${description}${extra}\n---\n`
}

test("every catalog field accepts each documented YAML type and rejects a number", async () => {
  expect(SKILL_SCHEMA.map(({ name }) => name)).toHaveLength(20)
  for (const entry of SKILL_SCHEMA) {
    const acceptedTypes = new Set(
      entry.variants.flatMap(({ yamlTypes }) => yamlTypes)
    )
    for (const yamlType of acceptedTypes) {
      const value = entry.name === "name" ? "shipping" : YAML_VALUES[yamlType]
      // biome-ignore lint/performance/noAwaitInLoops: one protocol client must apply buffer states sequentially
      const diagnostics = await diagnosticsWith(
        frontmatterFor(entry.name, value)
      )
      expect(
        messages(diagnostics),
        `${entry.name} should accept ${yamlType}`
      ).not.toContainEqual(expect.stringContaining(`"${entry.name}" must be`))
    }

    const rejected = await diagnosticsWith(frontmatterFor(entry.name, "42"))
    expect(messages(rejected)).toContainEqual(
      expect.stringContaining(`Frontmatter field "${entry.name}" must be`)
    )
  }
})

test("duplicate known and unknown top-level keys target the duplicate key", async () => {
  for (const key of ["description", "future-field"]) {
    const first = key === "description" ? "" : `${key}: First\n`
    // biome-ignore lint/performance/noAwaitInLoops: one protocol client must apply buffer states sequentially
    const diagnostics = await diagnosticsWith(
      `---\nname: shipping\ndescription: First\n${first}${key}: Second\n---\n`
    )
    const duplicate = diagnostics.find(({ message }) =>
      String(message).includes(`Duplicate top-level frontmatter key "${key}"`)
    )
    expect(duplicate?.range).toEqual({
      end: { character: key.length, line: first ? 4 : 3 },
      start: { character: 0, line: first ? 4 : 3 },
    })
  }
})

test("wrong-type and name-syntax ranges exclude quotes and trailing comments", async () => {
  const diagnostics = await diagnosticsWith(
    '---\nname: "Bad Name" # comment\ndescription: [wrong] # comment\n---\n'
  )
  const invalidName = diagnostics.find(({ message }) =>
    String(message).includes("invalid canonical")
  )
  expect(invalidName?.range).toEqual({
    end: { character: 15, line: 1 },
    start: { character: 7, line: 1 },
  })
  const wrongType = diagnostics.find(({ message }) =>
    String(message).includes('"description" must be')
  )
  expect(wrongType?.range).toEqual({
    end: { character: 20, line: 2 },
    start: { character: 13, line: 2 },
  })
})

test("canonical syntax accepts underscores, colons, repeated separators, and unlimited length", async () => {
  const names = ["under_score", "plugin:skill", "a::b", "a--b", "a".repeat(65)]
  for (const name of names) {
    // biome-ignore lint/performance/noAwaitInLoops: one protocol client must apply buffer states sequentially
    const diagnostics = await diagnosticsWith(
      `---\nname: ${name}\ndescription: Valid\n---\n`,
      `.claude/skills/${name}/SKILL.md`
    )
    expect(messages(diagnostics)).not.toContainEqual(
      expect.stringContaining("invalid canonical")
    )
  }
})

test("canonical syntax rejects uppercase, leading/trailing separators, spaces, dots, and slashes", async () => {
  for (const name of [
    "Upper",
    "-leading",
    "trailing-",
    "two words",
    "has.dot",
  ]) {
    // biome-ignore lint/performance/noAwaitInLoops: one protocol client must apply buffer states sequentially
    const diagnostics = await diagnosticsWith(
      `---\nname: ${name}\ndescription: Valid\n---\n`,
      `.claude/skills/${name}/SKILL.md`
    )
    expect(messages(diagnostics)).toContainEqual(
      expect.stringContaining("invalid canonical")
    )
  }

  const slash = await diagnosticsWith(
    "---\nname: has/slash\ndescription: Valid\n---\n"
  )
  expect(messages(slash)).toContainEqual(
    expect.stringContaining("invalid canonical")
  )
})
