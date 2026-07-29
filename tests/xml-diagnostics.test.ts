import { expect, test } from "bun:test"
import {
  DiagnosticSeverity,
  DidChangeTextDocumentNotification,
  type Range,
} from "vscode-languageserver-protocol"
import { startClient } from "./helpers/harness"

const c = await startClient()

function rangeOfText(text: string, needle: string, occurrence = 1): Range {
  let index = -1
  for (let count = 0; count < occurrence; count += 1) {
    index = text.indexOf(needle, index + 1)
    if (index === -1) {
      throw new Error(`"${needle}" (x${occurrence}) not found`)
    }
  }
  const before = text.slice(0, index)
  const line = before.split("\n").length - 1
  const character = index - (before.lastIndexOf("\n") + 1)
  return {
    end: { character: character + needle.length, line },
    start: { character, line },
  }
}

async function diagnosticsForText(rel: string, text: string) {
  const uri = c.uriFor(rel)
  c.diagnostics.delete(uri)
  await c.open(rel, text)
  await c.settle()
  return c.diagnostics.get(uri)
}

test("valid XML-shaped Markdown and literal comparisons stay clean", async () => {
  const rel = ".claude/xml-valid.md"
  const text = [
    "<root>",
    "  <item expression=\"a > b\" quoted='x > y'>value</item>",
    "  <same><same></same></same>",
    "  <multiline",
    '    title="still > quoted">',
    "  </multiline>",
    '  <self-closing answer="yes" />',
    "  <!-- <comment-example> -->",
    "  <![CDATA[<cdata-example>]]>",
    '  <?instruction target="<ignored>"?>',
    "  <!DOCTYPE root [<!ELEMENT root ANY>]>",
    "  <area><base><br><col><embed><hr><img><input>",
    "  <link><meta><param><source><track><wbr>",
    "</root>",
    "",
    "```xml",
    "<fenced-example>",
    "```",
    "Inline `<inline-example>` and ``<double-backtick>`` stay examples.",
    "Comparisons such as 1 < 2 and 3 > 1 are text.",
    "A Markdown autolink stays valid: <https://example.com/a?b=c>.",
    "A real skill reference still works: /shipping.",
  ].join("\n")

  expect(await diagnosticsForText(rel, text)).toBeUndefined()
  expect(c.publishLog.some((publish) => publish.uri === c.uriFor(rel))).toBe(
    false
  )
})

test("unclosed, mismatched, and unmatched tags have distinct precise diagnostics", async () => {
  const unclosedText = "<outer><leaf></leaf>"
  const unclosed = await diagnosticsForText(
    ".claude/xml-unclosed.md",
    unclosedText
  )
  expect(unclosed).toEqual([
    {
      message: 'Unclosed tag "<outer>".',
      range: rangeOfText(unclosedText, "outer"),
      severity: DiagnosticSeverity.Error,
      source: "skill-language-server",
    },
  ])

  const mismatchedText = "<outer></inner>"
  const mismatched = await diagnosticsForText(
    ".claude/xml-mismatched.md",
    mismatchedText
  )
  expect(mismatched).toEqual([
    {
      message: 'Closing tag "</inner>" does not match open tag "<outer>".',
      range: rangeOfText(mismatchedText, "inner"),
      severity: DiagnosticSeverity.Error,
      source: "skill-language-server",
    },
  ])

  const unmatchedText = "</orphan>"
  const unmatched = await diagnosticsForText(
    ".claude/xml-unmatched.md",
    unmatchedText
  )
  expect(unmatched).toEqual([
    {
      message: 'Closing tag "</orphan>" has no matching opener.',
      range: rangeOfText(unmatchedText, "orphan"),
      severity: DiagnosticSeverity.Error,
      source: "skill-language-server",
    },
  ])
})

test("nested failures recover deterministically without redundant cascades", async () => {
  const text = "<outer><middle><inner></outer></extra>"
  const diagnostics = await diagnosticsForText(
    ".claude/xml-nested-failure.md",
    text
  )

  expect(
    diagnostics?.map(({ message, range }) => ({ message, range }))
  ).toEqual([
    {
      message: 'Closing tag "</outer>" does not match open tag "<inner>".',
      range: rangeOfText(text, "outer", 2),
    },
    {
      message: 'Closing tag "</extra>" has no matching opener.',
      range: rangeOfText(text, "extra"),
    },
  ])
})

test("XML, frontmatter, and skill-reference diagnostics coexist", async () => {
  const diagnostics = await diagnosticsForText(
    ".claude/skills/xml-composed/SKILL.md",
    [
      "---",
      "name: wrong-name",
      "description: Exercises composed diagnostics.",
      "---",
      "/completely-unknown",
      "<root>",
    ].join("\n")
  )
  const messages = diagnostics?.map(({ message }) => String(message)) ?? []

  expect(
    messages.some((message) =>
      message.includes('Unknown skill "completely-unknown"')
    )
  ).toBe(true)
  expect(
    messages.some((message) =>
      message.includes('does not match folder name "xml-composed"')
    )
  ).toBe(true)
  expect(messages).toContain('Unclosed tag "<root>".')
})

test("repairing a dirty buffer sends exactly one clearing publish", async () => {
  const rel = ".claude/xml-repair.md"
  const uri = c.uriFor(rel)
  await c.open(rel, "<root>")
  await c.settle()
  const diagnostics = c.diagnostics.get(uri)
  expect(diagnostics).toHaveLength(1)

  const clearsBefore = c.publishLog.filter(
    (publish) => publish.uri === uri && publish.diagnostics.length === 0
  ).length
  await c.conn.sendNotification(DidChangeTextDocumentNotification.type, {
    contentChanges: [{ text: "<root></root>" }],
    textDocument: { uri, version: 2 },
  })
  await c.settle()
  const clearsAfter = c.publishLog.filter(
    (publish) => publish.uri === uri && publish.diagnostics.length === 0
  ).length

  expect(c.diagnostics.get(uri)).toEqual([])
  expect(clearsAfter - clearsBefore).toBe(1)
})

test("XML diagnostics receive no speculative code actions", async () => {
  const rel = ".claude/xml-no-actions.md"
  const diagnostics = await diagnosticsForText(rel, "<root>")
  expect(diagnostics).toHaveLength(1)
  const diagnostic = diagnostics?.[0]
  if (!diagnostic) {
    throw new Error("expected an XML diagnostic")
  }
  const actions = await c.codeActions(rel, diagnostic.range, [diagnostic])
  expect(actions).toEqual([])
})
