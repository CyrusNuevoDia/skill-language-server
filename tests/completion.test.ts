import { expect, test } from "bun:test"
import { completionItemsOf, startClient } from "./_harness"

const c = await startClient()

test("typing / offers every skill with its description", async () => {
  await c.open(".claude/draft.md", "Use /")
  const items = completionItemsOf(
    await c.completion(".claude/draft.md", { character: 5, line: 0 })
  )
  const labels = items.map((i) => i.label)

  expect(labels).toContain("shipping")
  expect(labels).toContain("billing")
  expect(labels).toContain("deploy")

  const shipping = items.find((i) => i.label === "shipping")
  const doc =
    typeof shipping?.documentation === "string"
      ? shipping.documentation
      : (shipping?.documentation?.value ?? shipping?.detail ?? "")
  expect(doc).toContain("Calculate shipping costs")
})

test("no completion after path segments", async () => {
  await c.open(".claude/draft-path.md", "See docs/")
  const res = await c.completion(".claude/draft-path.md", {
    character: 9,
    line: 0,
  })
  expect(completionItemsOf(res)).toEqual([])
})

test("no completion inside fenced code blocks", async () => {
  await c.open(".claude/draft-fence.md", "```bash\ncat /\n```\n")
  const res = await c.completion(".claude/draft-fence.md", {
    character: 5,
    line: 1,
  })
  expect(completionItemsOf(res)).toEqual([])
})

test("items carry a textEdit replacing the typed prefix — client word boundaries would mangle `-`/`:` names", async () => {
  await c.open(".claude/draft-prefix.md", "Use /shipp")
  const items = completionItemsOf(
    await c.completion(".claude/draft-prefix.md", { character: 10, line: 0 })
  )
  const shipping = items.find((i) => i.label === "shipping")
  expect(shipping?.filterText).toBe("shipping")
  expect(shipping?.textEdit).toEqual({
    newText: "shipping",
    range: {
      end: { character: 10, line: 0 },
      start: { character: 5, line: 0 },
    },
  })
})

test("typing $ offers the same skills", async () => {
  await c.open(".claude/draft-dollar.md", "Use $")
  const items = completionItemsOf(
    await c.completion(".claude/draft-dollar.md", { character: 5, line: 0 })
  )
  expect(items.map((i) => i.label)).toContain("shipping")
})
