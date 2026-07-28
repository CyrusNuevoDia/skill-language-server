import { afterAll, beforeAll, expect, test } from "bun:test"
import { asLocations, Client, contentOf } from "./harness"

let c: Client
beforeAll(async () => {
  c = await Client.start()
})
afterAll(() => c.stop())

/**
 * Open `rel` with override text and settle; returns what the server published
 * for it, or undefined when it stayed clean (clean files are never published).
 */
async function diagnosticsWith(rel: string, text: string) {
  c.diagnostics.delete(c.uriFor(rel))
  await c.open(rel, text)
  await c.settle()
  return c.diagnostics.get(c.uriFor(rel))
}

test("a ``` fence containing a ~~~ line stays one code block", async () => {
  const diags = await diagnosticsWith(
    ".claude/fence-edge.md",
    "```\n~~~\n/qqzzqq\n~~~\n```\n"
  )
  expect(diags).toBeUndefined()
})

test("a longer closing fence ends the block; a shorter one does not", async () => {
  const diags = await diagnosticsWith(
    ".claude/fence-length.md",
    "````\n```\n/qqzzqq\n````\n"
  )
  expect(diags).toBeUndefined()
})

test("home-directory paths are never skill references", async () => {
  const diags = await diagnosticsWith(
    ".claude/tilde-edge.md",
    "Data lives in ~/scripts; see also ~/shippin\n"
  )
  expect(diags).toBeUndefined()
})

test("an indented --- inside a block scalar does not close the frontmatter", async () => {
  const rel = ".claude/skills/shipping/SKILL.md"
  const diags = await diagnosticsWith(
    rel,
    "---\ndescription: |\n  ---\nname: shipping\n---\n"
  )
  expect(diags).toBeUndefined()
  await c.close(rel)
})

test("a wrong-typed frontmatter field does not erase the well-typed name", async () => {
  const rel = ".claude/skills/shipping/SKILL.md"
  const diags = await diagnosticsWith(
    rel,
    "---\nname: shipping\ndescription: 42\n---\n"
  )
  expect(diags).toBeUndefined()
  await c.close(rel)
})

test("tokens inside frontmatter are never scanned", async () => {
  const rel = ".claude/skills/shipping/SKILL.md"
  const diags = await diagnosticsWith(
    rel,
    "---\nname: shipping\ndescription: /qqzzqq\n---\n"
  )
  expect(diags).toBeUndefined()
  await c.close(rel)
})

test("empty frontmatter yields no fields and scanning resumes after it", async () => {
  const rel = ".claude/skills/shipping/SKILL.md"
  const diags = await diagnosticsWith(rel, "---\n---\n/qqzzqq\n")
  expect(diags?.some((d) => String(d.message).includes("missing"))).toBe(true)
  expect(diags?.some((d) => String(d.message).includes("qqzzqq"))).toBe(true)
  await c.close(rel)
})

test("malformed YAML frontmatter is token-scanned as body", async () => {
  const rel = ".claude/skills/shipping/SKILL.md"
  const diags = await diagnosticsWith(
    rel,
    "---\nname: [unclosed\ndescription: /qqzzqq\n---\n"
  )
  expect(diags?.some((d) => String(d.message).includes("qqzzqq"))).toBe(true)
  await c.close(rel)
})

test("a YAML comment after the name stays outside the declaration range", async () => {
  const rel = ".claude/skills/shipping/SKILL.md"
  await c.open(rel, "---\nname: shipping # owned by logistics\n---\n")
  const res = await c.prepareRename(rel, { character: 8, line: 1 })
  expect(res).toEqual({
    placeholder: "shipping",
    range: {
      end: { character: 14, line: 1 },
      start: { character: 6, line: 1 },
    },
  })
  await c.close(rel)
})

test("closing a dirty buffer without saving reverts to disk truth", async () => {
  const rel = ".claude/skills/shipping/SKILL.md"
  const dirty = await diagnosticsWith(
    rel,
    contentOf(rel).replace("name: shipping", "name: shippingz")
  )
  expect(dirty?.some((d) => String(d.message).includes("shippingz"))).toBe(true)

  c.diagnostics.delete(c.uriFor(rel))
  await c.close(rel)
  expect(await c.diagnosticsFor(rel)).toEqual([])
})

test("a definition request right after didClose sees disk truth", async () => {
  const rel = ".claude/skills/shipping/SKILL.md"
  const pos = { character: 1, line: 0 }
  // Buffer replaces line 0 (disk: "---") with a resolvable reference.
  await c.open(rel, "/billing\n")
  expect(asLocations(await c.definition(rel, pos))).not.toEqual([])

  // No settle() between close and definition: the request itself must queue
  // behind the async disk re-read that didClose triggers, or it would still
  // see the closed buffer's token here.
  await c.close(rel)
  expect(asLocations(await c.definition(rel, pos))).toEqual([])
})
