import { expect, test } from "bun:test"
import type {
  CodeAction,
  Diagnostic,
  WorkspaceEdit,
} from "vscode-languageserver-protocol"
import { locOf, SHIPPING_DECL, SHIPPING_REFS } from "./corpus"
import {
  asLocations,
  contentOf,
  posOf,
  rangeOf,
  sortByPos,
  startClient,
  textEditsOf,
  uriFor,
} from "./helpers/harness"

const REL = ".claude/markdown-links.md"
const c = await startClient()

const brokenLinks = async (): Promise<Diagnostic[]> =>
  (await c.diagnosticsFor(REL)).filter(
    (diagnostic) => diagnostic.code === "broken-markdown-link"
  )

const diagnosticMessage = (diagnostic: Diagnostic): string =>
  typeof diagnostic.message === "string"
    ? diagnostic.message
    : diagnostic.message.value

test("valid and ignored Markdown destinations remain clean", async () => {
  const diagnostics = await brokenLinks()
  const messages = diagnostics.map(diagnosticMessage)

  expect(diagnostics).toHaveLength(7)
  for (const ignored of [
    "https://example.com/missing",
    "//example.com/missing",
    "mailto:test@example.com",
    "#local",
    "/tmp/missing",
    "missing-image.md",
    "missing-inline.md",
    "missing-escaped.md",
    "missing-reference.md",
    "missing-malformed.md",
    "missing-fenced.md",
  ]) {
    expect(messages.some((message) => message.includes(ignored))).toBe(false)
  }
})

test("broken-link diagnostics precisely cover authored destinations", async () => {
  const diagnostics = await brokenLinks()
  const destination = "link-targets/Guide.md?view=1#intro"
  expect(diagnostics.map((diagnostic) => diagnostic.range)).toContainEqual(
    rangeOf(REL, destination, {
      length: destination.length,
    })
  )
})

test("case-only and unique sibling repairs preserve suffixes and resolve", async () => {
  await expectRepair(
    "link-targets/Guide.md?view=1#intro",
    "link-targets/guide.md?view=1#intro"
  )
  await expectRepair(
    "link-targets/raed%20me.md#top",
    "link-targets/read%20me.md#top"
  )
})

async function expectRepair(needle: string, expected: string): Promise<void> {
  const diagnostic = (await brokenLinks()).find((item) =>
    diagnosticMessage(item).includes(needle)
  )
  expect(diagnostic).toBeDefined()
  const actions = (await c.codeActions(
    REL,
    diagnostic?.range ?? rangeOf(REL, needle, { length: needle.length }),
    diagnostic ? [diagnostic] : []
  )) as CodeAction[]
  expect(actions).toHaveLength(1)
  const [edit] = textEditsOf(actions[0].edit ?? {})
  expect(edit).toBeDefined()

  const text = applyEdit(contentOf(REL), edit)
  expect(text).toContain(expected)
  await c.open(REL, text)
  await c.settle()
  expect(
    (await brokenLinks()).some((item) =>
      diagnosticMessage(item).includes(needle)
    )
  ).toBe(false)
  await c.close(REL)
  await c.settle()
}

test("speculative repairs and unrelated diagnostics return no actions", async () => {
  const diagnostics = await brokenLinks()
  const needles = [
    "link-targets/gude.md",
    "link-targets/xyzde.md",
    "missing/readme.md",
    "link-targets/raed%20me.txt",
    "link-targets/not-a-target.md",
  ]
  const results = await Promise.all(
    needles.map((needle) => {
      const diagnostic = diagnostics.find((item) =>
        diagnosticMessage(item).includes(needle)
      )
      expect(diagnostic).toBeDefined()
      return c.codeActions(
        REL,
        diagnostic?.range ?? rangeOf(REL, needle, { length: needle.length }),
        diagnostic ? [diagnostic] : []
      )
    })
  )
  for (const actions of results) {
    expect(actions).toEqual([])
  }
  const unrelated: Diagnostic = {
    message: "not owned",
    range: rangeOf(REL, "Markdown", { length: 8 }),
  }
  expect(await c.codeActions(REL, unrelated.range, [unrelated])).toEqual([])
})

test("skill directory and SKILL.md links are first-class references", async () => {
  const needles = [
    "skills/shipping?mode=fast#intro",
    "skills/shipping/SKILL.md#usage",
  ]
  const results = await Promise.all(
    needles.map(async (needle) => ({
      definition: await c.definition(REL, posOf(REL, needle, { offset: 3 })),
      prepared: await c.prepareRename(REL, posOf(REL, needle, { offset: 3 })),
    }))
  )
  for (const { definition, prepared } of results) {
    expect(asLocations(definition)).toEqual([locOf(SHIPPING_DECL)])
    expect(prepared).toMatchObject({ placeholder: "shipping" })
  }

  const references = await c.references(
    REL,
    posOf(REL, "shipping directory", { offset: 2 })
  )
  expect(sortByPos(references ?? [])).toEqual(
    sortByPos(SHIPPING_REFS.map(locOf))
  )

  const semantic = await c.semanticTokens(REL)
  const shippingRanges = SHIPPING_REFS.filter(({ rel }) => rel === REL).map(
    ({ length, needle, offset }) => ({
      ...posOf(REL, needle, { offset }),
      length,
    })
  )
  expect(decodeSemanticTokens(semantic?.data ?? [])).toEqual(
    expect.arrayContaining(shippingRanges)
  )
})

test("rename edits only skill path segments and preserves link syntax", async () => {
  const edit = (await c.rename(
    REL,
    posOf(REL, "shipping directory", { offset: 2 }),
    "overnight"
  )) as WorkspaceEdit
  const linkEdits = textEditsOf(edit).filter(({ uri }) => uri === uriFor(REL))

  expect(linkEdits).toEqual([
    {
      newText: "overnight",
      range: rangeOf(REL, "skills/shipping", { length: 8, offset: 7 }),
      uri: uriFor(REL),
    },
    {
      newText: "overnight",
      range: rangeOf(REL, "skills/shipping/SKILL.md", {
        length: 8,
        offset: 7,
      }),
      uri: uriFor(REL),
    },
  ])
})

test("duplicate links resolve first-indexed while symlink-side links resolve", async () => {
  const duplicate = await c.definition(
    REL,
    posOf(REL, "../docs/skills/deploy", { offset: 10 })
  )
  expect(asLocations(duplicate)[0]?.uri).toBe(
    uriFor(".agents/skills/deploy/SKILL.md")
  )

  const linked = await c.definition(
    REL,
    posOf(REL, "skills/linked/SKILL.md", { offset: 8 })
  )
  expect(asLocations(linked)[0]?.uri).toBe(
    uriFor(".claude/skills/linked/SKILL.md")
  )
})

function applyEdit(
  text: string,
  edit: { newText: string; range: Diagnostic["range"] }
): string {
  const lines = text.split("\n")
  const line = lines[edit.range.start.line]
  lines[edit.range.start.line] =
    line.slice(0, edit.range.start.character) +
    edit.newText +
    line.slice(edit.range.end.character)
  return lines.join("\n")
}

function decodeSemanticTokens(
  data: number[]
): Array<{ character: number; length: number; line: number }> {
  const tokens: Array<{ character: number; length: number; line: number }> = []
  let line = 0
  let character = 0
  for (let i = 0; i < data.length; i += 5) {
    const [deltaLine, deltaCharacter, length] = data.slice(i, i + 5)
    line += deltaLine
    character = deltaLine === 0 ? character + deltaCharacter : deltaCharacter
    tokens.push({ character, length, line })
  }
  return tokens
}
