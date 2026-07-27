import { afterAll, beforeAll, expect, test } from "bun:test"
import { Client, completionItemsOf } from "./harness"

let c: Client
beforeAll(async () => {
  c = await Client.start()
})
afterAll(() => c.stop())

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

test("typing $ offers the same skills", async () => {
  await c.open(".claude/draft-dollar.md", "Use $")
  const items = completionItemsOf(
    await c.completion(".claude/draft-dollar.md", { character: 5, line: 0 })
  )
  expect(items.map((i) => i.label)).toContain("shipping")
})
