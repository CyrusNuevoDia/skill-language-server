import { expect, test } from "bun:test"
import type { Hover } from "vscode-languageserver-protocol"
import { contentOf, posOf, rangeOf, startClient } from "./helpers/harness"

const c = await startClient()

const SHIPPING = ".claude/skills/shipping/SKILL.md"
const SHIPPING_CONTENT =
  "**shipping**\n\nCalculate shipping costs and delivery estimates for orders.\n\n`.claude/skills/shipping/SKILL.md`"
const SHIPPING_RANGE = rangeOf(".claude/CLAUDE.md", "/shipping", {
  length: 9,
})

test("server advertises hover and the harness sends hover requests", async () => {
  expect(c.serverCapabilities.hoverProvider).toBe(true)
  expect(
    await c.hover(
      ".claude/CLAUDE.md",
      posOf(".claude/CLAUDE.md", "/shipping", { offset: 3 })
    )
  ).toBeTruthy()
})

test("slash and dollar references hover across sigil and name", async () => {
  const slashRel = ".claude/CLAUDE.md"
  const dollarRel = ".claude/agents/reviewer.md"
  const [slashSigil, slashName, dollarSigil, dollarName] = await Promise.all([
    c.hover(slashRel, posOf(slashRel, "/shipping")),
    c.hover(slashRel, posOf(slashRel, "/shipping", { offset: 3 })),
    c.hover(dollarRel, posOf(dollarRel, "$shipping")),
    c.hover(dollarRel, posOf(dollarRel, "$shipping", { offset: 4 })),
  ])
  for (const hover of [slashSigil, slashName]) {
    expect(hover).toEqual({
      contents: { kind: "markdown", value: SHIPPING_CONTENT },
      range: SHIPPING_RANGE,
    })
  }
  for (const hover of [dollarSigil, dollarName]) {
    expect(hover).toEqual({
      contents: { kind: "markdown", value: SHIPPING_CONTENT },
      range: rangeOf(dollarRel, "$shipping", { length: 9 }),
    })
  }
})

async function expectDescriptionOmitted(field: string): Promise<void> {
  await c.open(SHIPPING, `---\nname: shipping\n${field}\n---\n`)
  await c.settle()
  const hover = (await c.hover(
    ".claude/CLAUDE.md",
    posOf(".claude/CLAUDE.md", "/shipping", { offset: 3 })
  )) as Hover
  expect(hover.contents).toEqual({
    kind: "markdown",
    value: "**shipping**\n\n`.claude/skills/shipping/SKILL.md`",
  })
  await c.close(SHIPPING)
}

test("declaration hover uses the canonical name and declaration range", async () => {
  const hover = await c.hover(
    SHIPPING,
    posOf(SHIPPING, "name: shipping", { offset: 8 })
  )
  expect(hover).toEqual({
    contents: { kind: "markdown", value: SHIPPING_CONTENT },
    range: rangeOf(SHIPPING, "name: shipping", { length: 8, offset: 6 }),
  })
})

test("skill Markdown links hover by destination while normal links return null", async () => {
  const rel = ".claude/hover-links.md"
  const directoryLink = "[shipping directory](./skills/shipping)"
  const fileLink = "[different label](./skills/shipping/SKILL.md)"
  const normalLink = "[instructions](./CLAUDE.md)"
  await c.open(
    rel,
    `See ${directoryLink} now.\nSee ${fileLink} now.\nSee ${normalLink} now.\n`
  )

  const directoryHover = await c.hover(rel, { character: 8, line: 0 })
  const fileHover = await c.hover(rel, { character: 34, line: 1 })
  expect(directoryHover).toEqual({
    contents: { kind: "markdown", value: SHIPPING_CONTENT },
    range: {
      end: { character: directoryLink.length + 4, line: 0 },
      start: { character: 4, line: 0 },
    },
  })
  expect(fileHover).toEqual({
    contents: { kind: "markdown", value: SHIPPING_CONTENT },
    range: {
      end: { character: fileLink.length + 4, line: 1 },
      start: { character: 4, line: 1 },
    },
  })
  expect(await c.hover(rel, { character: 8, line: 2 })).toBeNull()
  expect(await c.hover(rel, { character: 3, line: 0 })).toBeNull()
  expect(
    await c.hover(rel, { character: directoryLink.length + 5, line: 0 })
  ).toBeNull()
  await c.close(rel)
})

test("unsaved descriptions are authoritative until the skill closes", async () => {
  const dirtyDescription = "Current unsaved shipping documentation."
  const referenceRel = ".claude/hover-reference.md"
  await c.open(referenceRel, "Use /shipping.")
  await c.open(
    SHIPPING,
    contentOf(SHIPPING).replace(
      "Calculate shipping costs and delivery estimates for orders.",
      dirtyDescription
    )
  )
  await c.settle()

  const dirty = (await c.hover(referenceRel, {
    character: 6,
    line: 0,
  })) as Hover
  expect(dirty.contents).toEqual({
    kind: "markdown",
    value: `**shipping**\n\n${dirtyDescription}\n\n\`.claude/skills/shipping/SKILL.md\``,
  })

  await c.close(SHIPPING)
  const disk = await c.hover(referenceRel, { character: 6, line: 0 })
  expect(disk).toEqual({
    contents: { kind: "markdown", value: SHIPPING_CONTENT },
    range: {
      end: { character: 13, line: 0 },
      start: { character: 4, line: 0 },
    },
  })
  await c.close(referenceRel)
})

test("unusable descriptions are omitted without hiding valid skills", async () => {
  await expectDescriptionOmitted("")
  await expectDescriptionOmitted('description: ""')
  await expectDescriptionOmitted("description: 42")
})

test("duplicate declarations use their own twin while references use the first indexed", async () => {
  const agentsTwin = ".agents/skills/deploy/SKILL.md"
  const docsTwin = "docs/skills/deploy/SKILL.md"

  const agentsHover = (await c.hover(
    agentsTwin,
    posOf(agentsTwin, "name: deploy", { offset: 8 })
  )) as Hover
  expect(JSON.stringify(agentsHover.contents)).toContain(
    "Duplicate deploy skill"
  )
  expect(JSON.stringify(agentsHover.contents)).toContain(agentsTwin)

  const docsHover = (await c.hover(
    docsTwin,
    posOf(docsTwin, "name: deploy", { offset: 8 })
  )) as Hover
  expect(JSON.stringify(docsHover.contents)).toContain(
    "Deploy the service to production."
  )
  expect(JSON.stringify(docsHover.contents)).toContain(docsTwin)

  await c.open(".claude/deploy-hover.md", "Use /deploy.")
  const referenceHover = await c.hover(".claude/deploy-hover.md", {
    character: 5,
    line: 0,
  })
  expect(referenceHover?.contents).toEqual(agentsHover.contents)
})

test("unknown and malformed declarations return null", async () => {
  expect(
    await c.hover(
      ".claude/skills/typo-source/SKILL.md",
      posOf(".claude/skills/typo-source/SKILL.md", "/completely-unknown", {
        offset: 3,
      })
    )
  ).toBeNull()
  expect(
    await c.hover(".claude/skills/noname/SKILL.md", {
      character: 1,
      line: 0,
    })
  ).toBeNull()
})

test("positions immediately outside token and declaration ranges return null", async () => {
  const tokenRange = SHIPPING_RANGE
  expect(
    await c.hover(".claude/CLAUDE.md", {
      character: tokenRange.start.character - 1,
      line: tokenRange.start.line,
    })
  ).toBeNull()
  expect(
    await c.hover(".claude/CLAUDE.md", {
      character: tokenRange.end.character + 1,
      line: tokenRange.end.line,
    })
  ).toBeNull()

  const declarationRange = rangeOf(SHIPPING, "name: shipping", {
    length: 8,
    offset: 6,
  })
  expect(
    await c.hover(SHIPPING, {
      character: declarationRange.start.character - 1,
      line: declarationRange.start.line,
    })
  ).toBeNull()
  expect(
    await c.hover(SHIPPING, {
      character: declarationRange.end.character + 1,
      line: declarationRange.end.line,
    })
  ).toBeNull()
})
