import { afterAll, beforeAll, expect, test } from "bun:test"
import { Client, posOf } from "./harness"

type DecodedToken = { character: number; length: number; line: number }

function decode(data: number[]): DecodedToken[] {
  const tokens: DecodedToken[] = []
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

let c: Client
beforeAll(async () => {
  c = await Client.start()
})
afterAll(() => c.stop())

test("semantic tokens cover resolved /shipping references", async () => {
  const rel = ".claude/skills/billing/SKILL.md"
  const res = await c.semanticTokens(rel)

  expect(decode(res?.data ?? [])).toEqual([
    { ...posOf(rel, "/shipping", { occurrence: 1 }), length: 9 },
    { ...posOf(rel, "/shipping", { occurrence: 2 }), length: 9 },
  ])
})

test("semantic tokens omit unresolved references", async () => {
  const res = await c.semanticTokens(".claude/skills/typo-source/SKILL.md")

  expect(decode(res?.data ?? [])).toEqual([])
})

test("semantic tokens omit fenced references", async () => {
  const rel = ".claude/skills/shipping/SKILL.md"
  const res = await c.semanticTokens(rel)

  expect(decode(res?.data ?? [])).toEqual([
    { ...posOf(rel, "$billing"), length: 8 },
  ])
})
