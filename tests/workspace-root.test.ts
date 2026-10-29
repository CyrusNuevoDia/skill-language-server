import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { WorkspaceEdit } from "vscode-languageserver-protocol"
import {
  asLocations,
  Client,
  renameFilesOf,
  textEditsOf,
} from "./helpers/harness"

const TEMP = mkdtempSync(join(tmpdir(), "skill-workspace-roots-"))
const REFERENCE_POSITION = { character: 7, line: 0 }

afterAll(() => rmSync(TEMP, { force: true, recursive: true }))

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const skill = (name: string) =>
  `---\nname: ${name}\ndescription: A workspace-root test skill.\n---\n`

for (const [scope, declaration] of [
  [".claude", "skills/shipping/SKILL.md"],
  [".agents", "skills/shipping/SKILL.md"],
  [".codex", "skills/shipping/SKILL.md"],
  ["skills", "shipping/SKILL.md"],
  [".claude/skills/shipping", "SKILL.md"],
] as const) {
  test(`opening ${scope} as the workspace preserves its reference scope`, async () => {
    const root = join(mkdtempSync(join(TEMP, "scope-")), scope)
    write(join(root, declaration), skill("shipping"))
    write(join(root, "agents/reviewer.md"), "Use /shipping.\n")
    const client = await Client.start(root)
    try {
      expect(
        asLocations(
          await client.definition("agents/reviewer.md", REFERENCE_POSITION)
        ).map(({ uri }) => uri)
      ).toEqual([client.uriFor(declaration)])

      const edit = (await client.rename(
        "agents/reviewer.md",
        REFERENCE_POSITION,
        "overnight"
      )) as WorkspaceEdit
      expect(new Set(textEditsOf(edit).map(({ uri }) => uri))).toEqual(
        new Set([
          client.uriFor(declaration),
          client.uriFor("agents/reviewer.md"),
        ])
      )
      expect(renameFilesOf(edit)).toEqual([
        {
          newUri: client.uriFor(join(dirname(declaration), "..", "overnight")),
          oldUri: client.uriFor(dirname(declaration)),
        },
      ])
    } finally {
      client.stop()
    }
  })
}

test("a scoped root still honors root-relative ignores and workspace containment", async () => {
  const root = join(TEMP, "boundaries", ".claude")
  const declaration = "skills/shipping/SKILL.md"
  write(join(root, declaration), skill("shipping"))
  write(join(root, "notes.md"), "Use /shipping.\n")
  write(join(root, "ignored.md"), "Use /shipping.\n")
  write(join(root, ".skillignore"), "ignored.md\n")
  const client = await Client.start(root)
  try {
    await client.open("ignored.md")
    await client.open("../.agents/outside.md", "Use /shipping.\n")
    expect(
      await Promise.all(
        ["ignored.md", "../.agents/outside.md"].map((rel) =>
          client.definition(rel, REFERENCE_POSITION)
        )
      )
    ).toEqual([null, null])
    const references = await client.references(
      "notes.md",
      REFERENCE_POSITION,
      true
    )
    expect(new Set(references?.map(({ uri }) => uri))).toEqual(
      new Set([client.uriFor(declaration), client.uriFor("notes.md")])
    )
  } finally {
    client.stop()
  }
})

for (const directory of [
  "skill-language-server/.claude-project",
  ".codex/worktrees/id/project",
]) {
  test(`ordinary workspace ${directory} does not inherit an unrelated ancestor scope`, async () => {
    const root = join(TEMP, directory)
    write(join(root, "skills/shipping/SKILL.md"), skill("shipping"))
    write(join(root, "notes.md"), "Use /shipping.\n")
    const client = await Client.start(root)
    try {
      await client.open("notes.md")
      expect(await client.definition("notes.md", REFERENCE_POSITION)).toBeNull()
      expect(
        await client.references("skills/shipping/SKILL.md", {
          character: 8,
          line: 1,
        })
      ).toEqual([])
    } finally {
      client.stop()
    }
  })
}

test("skill names can match artifact directories while ordinary artifacts stay skipped", async () => {
  const root = join(TEMP, "artifact-names")
  for (const name of ["build", "dist", "node_modules"]) {
    write(join(root, "skills", name, "SKILL.md"), skill(name))
    write(join(root, "skills", name, "notes.md"), `Use /${name}.\n`)
    write(
      join(root, name, "skills", `hidden-${name}`, "SKILL.md"),
      skill(`hidden-${name}`)
    )
  }
  write(
    join(root, "skills/.git/skills/git-private/SKILL.md"),
    skill("git-private")
  )
  write(join(root, "AGENTS.md"), "Use /build, /dist, and /node_modules.\n")
  const client = await Client.start(root)
  try {
    await Promise.all(
      (
        [
          ["build", 7],
          ["dist", 15],
          ["node_modules", 29],
        ] as const
      ).map(async ([name, character]) => {
        const position = { character, line: 0 }
        expect(
          asLocations(await client.definition("AGENTS.md", position)).map(
            ({ uri }) => uri
          )
        ).toEqual([client.uriFor(`skills/${name}/SKILL.md`)])
        const edit = (await client.rename(
          "AGENTS.md",
          position,
          `renamed-${name}`
        )) as WorkspaceEdit
        expect(new Set(textEditsOf(edit).map(({ uri }) => uri))).toEqual(
          new Set([
            client.uriFor("AGENTS.md"),
            client.uriFor(`skills/${name}/SKILL.md`),
            client.uriFor(`skills/${name}/notes.md`),
          ])
        )
      })
    )
    await client.open(
      "AGENTS.md",
      "Use /hidden-build.\nUse /hidden-dist.\nUse /hidden-node_modules.\nUse /git-private.\n"
    )
    expect(
      await Promise.all(
        [0, 1, 2, 3].map((line) =>
          client.definition("AGENTS.md", { character: 7, line })
        )
      )
    ).toEqual([null, null, null, null])
  } finally {
    client.stop()
  }
})
