import { expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  asLocations,
  Client,
  rangeOf,
  startClient,
  uriFor,
} from "./helpers/harness"

const c = await startClient()

test("definition through a symlinked skill folder uses the symlink-side URI", async () => {
  await c.open(".claude/linked-adhoc.md", "Use /linked here.\n")
  const res = await c.definition(".claude/linked-adhoc.md", {
    character: 7,
    line: 0,
  })
  const locs = asLocations(res)
  expect(locs).toEqual([
    {
      range: rangeOf(".claude/skills/linked/SKILL.md", "linked", { length: 6 }),
      uri: uriFor(".claude/skills/linked/SKILL.md"),
    },
  ])
  expect(locs[0]?.uri).not.toContain("linked-target")
})

test("symlinked skill is indexed once and is not its own duplicate", async () => {
  // Clean files are never published; a duplicate diagnostic would be.
  await c.settle()
  expect(c.diagnostics.has(uriFor(".claude/skills/linked/SKILL.md"))).toBe(
    false
  )
})

test("scan terminates on symlink cycles and skips broken symlinks", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "skill-symlink-cycle-"))
  try {
    const skills = join(tmp, ".claude", "skills")
    mkdirSync(join(skills, "real"), { recursive: true })
    writeFileSync(
      join(skills, "real", "SKILL.md"),
      "---\nname: real\ndescription: Cycle-workspace skill.\n---\n"
    )
    // skills/loop -> .claude makes .claude reachable from inside itself.
    symlinkSync(join("..", "..", ".claude"), join(skills, "loop"))
    symlinkSync("nowhere", join(skills, "broken"))

    const cycled = await Client.start(tmp)
    try {
      await cycled.open(".claude/notes.md", "Run /real now.\n")
      const res = await cycled.definition(".claude/notes.md", {
        character: 6,
        line: 0,
      })
      const locs = asLocations(res)
      expect(locs).toHaveLength(1)
      expect(locs[0]?.uri).toBe(cycled.uriFor(".claude/skills/real/SKILL.md"))
    } finally {
      cycled.stop()
    }
  } finally {
    rmSync(tmp, { force: true, recursive: true })
  }
})
