import { expect, test } from "bun:test"
import { asLocations, contentOf, startClient } from "./helpers/harness"

const c = await startClient()

const SHIPPING = ".claude/skills/shipping/SKILL.md"

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
  const diags = await diagnosticsWith(
    SHIPPING,
    "---\ndescription: |\n  ---\nname: shipping\n---\n"
  )
  expect(diags).toBeUndefined()
  await c.close(SHIPPING)
})

test("a wrong-typed frontmatter field does not erase the well-typed name", async () => {
  const diags = await diagnosticsWith(
    SHIPPING,
    "---\nname: shipping\ndescription: 42\n---\n"
  )
  expect(diags?.some((d) => String(d.message).includes("description"))).toBe(
    true
  )
  expect(diags?.some((d) => String(d.message).includes("name"))).toBe(false)
  await c.close(SHIPPING)
})

test("tokens inside frontmatter are never scanned", async () => {
  const diags = await diagnosticsWith(
    SHIPPING,
    "---\nname: shipping\ndescription: /qqzzqq\n---\n"
  )
  expect(diags).toEqual([])
  await c.close(SHIPPING)
})

test("empty frontmatter yields no fields and scanning resumes after it", async () => {
  const diags = await diagnosticsWith(SHIPPING, "---\n---\n/qqzzqq\n")
  expect(diags?.some((d) => String(d.message).includes("missing"))).toBe(true)
  expect(diags?.some((d) => String(d.message).includes("qqzzqq"))).toBe(true)
  await c.close(SHIPPING)
})

test("malformed YAML frontmatter is diagnosed without scanning its values as body tokens", async () => {
  const diags = await diagnosticsWith(
    SHIPPING,
    "---\nname: [unclosed\ndescription: /qqzzqq\n---\n"
  )
  expect(diags?.some((d) => String(d.message).includes("Malformed YAML"))).toBe(
    true
  )
  expect(diags?.some((d) => String(d.message).includes("qqzzqq"))).toBe(false)
  await c.close(SHIPPING)
})

test("a YAML comment after the name stays outside the declaration range", async () => {
  await c.open(SHIPPING, "---\nname: shipping # owned by logistics\n---\n")
  const res = await c.prepareRename(SHIPPING, { character: 8, line: 1 })
  expect(res).toEqual({
    placeholder: "shipping",
    range: {
      end: { character: 14, line: 1 },
      start: { character: 6, line: 1 },
    },
  })
  await c.close(SHIPPING)
})

test("closing a dirty buffer without saving reverts to disk truth", async () => {
  const dirty = await diagnosticsWith(
    SHIPPING,
    contentOf(SHIPPING).replace("name: shipping", "name: shippingz")
  )
  expect(dirty?.some((d) => String(d.message).includes("shippingz"))).toBe(true)

  c.diagnostics.delete(c.uriFor(SHIPPING))
  await c.close(SHIPPING)
  expect(await c.diagnosticsFor(SHIPPING)).toEqual([])
})

test("a definition request right after didClose sees disk truth", async () => {
  const pos = { character: 1, line: 0 }
  // Buffer replaces line 0 (disk: "---") with a resolvable reference.
  await c.open(SHIPPING, "/billing\n")
  expect(asLocations(await c.definition(SHIPPING, pos))).not.toEqual([])

  // No settle() between close and definition: the request itself must queue
  // behind the async disk re-read that didClose triggers, or it would still
  // see the closed buffer's token here.
  await c.close(SHIPPING)
  expect(asLocations(await c.definition(SHIPPING, pos))).toEqual([])
})
