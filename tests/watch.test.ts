import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  DidChangeWatchedFilesNotification,
  FileChangeType,
  type FileEvent,
} from "vscode-languageserver-protocol"
import {
  asLocations,
  Client,
  completionItemsOf,
  posOf,
  startClient,
  uriFor,
} from "./helpers/harness"

const c = await startClient()

const BILLING_SKILL = ".claude/skills/billing/SKILL.md"

const notifyChange = (type: FileChangeType) =>
  c.conn.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: [{ type, uri: uriFor(BILLING_SKILL) }],
  })

test("watcher events never override open buffers", async () => {
  // Buffer has the /shipping ref on line 3; the on-disk file has it on line 2.
  await c.open(".claude/CLAUDE.md", "a\nb\nc\nUse /shipping\n")
  await c.conn.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: [
      { type: FileChangeType.Changed, uri: uriFor(".claude/CLAUDE.md") },
    ],
  })
  const atBufferPos = await c.definition(".claude/CLAUDE.md", {
    character: 8,
    line: 3,
  })
  const atDiskPos = await c.definition(".claude/CLAUDE.md", {
    character: 33,
    line: 2,
  })
  expect(asLocations(atBufferPos)).toHaveLength(1)
  expect(asLocations(atDiskPos)).toEqual([])
})

test("watched-files delete drops a skill; re-create restores it", async () => {
  const pos = posOf(".codex/AGENTS.md", "/billing", { offset: 2 })

  expect(asLocations(await c.definition(".codex/AGENTS.md", pos))).toHaveLength(
    1
  )

  await notifyChange(FileChangeType.Deleted)
  expect(asLocations(await c.definition(".codex/AGENTS.md", pos))).toEqual([])

  await notifyChange(FileChangeType.Created)
  expect(asLocations(await c.definition(".codex/AGENTS.md", pos))).toHaveLength(
    1
  )
})

test("a folder delete (one event, no .md suffix) evicts everything under it", async () => {
  const pos = posOf(".codex/AGENTS.md", "/billing", { offset: 2 })

  await c.conn.sendNotification(DidChangeWatchedFilesNotification.type, {
    changes: [
      {
        type: FileChangeType.Deleted,
        uri: uriFor(".claude/skills/billing"),
      },
    ],
  })
  expect(asLocations(await c.definition(".codex/AGENTS.md", pos))).toEqual([])

  await notifyChange(FileChangeType.Created)
  expect(asLocations(await c.definition(".codex/AGENTS.md", pos))).toHaveLength(
    1
  )
})

test("a folder-created event discovers a whole skill without losing dirty buffers or ignore rules", async () => {
  const temp = mkdtempSync(join(tmpdir(), "skill-folder-create-"))
  const root = join(temp, "workspace")
  mkdirSync(root)
  writeFileSync(join(root, "AGENTS.md"), "Saved prose has no reference.\n")
  writeFileSync(
    join(root, ".skillignore"),
    ".claude/skills/ignored/\n.claude/skills/arrived/private.md\n"
  )
  const client = await Client.start(root)
  try {
    await client.open("AGENTS.md", "Use /arrived.\nTry /\n")
    expect(
      await client.definition("AGENTS.md", { character: 7, line: 0 })
    ).toBeNull()

    const added = ".claude/skills/arrived"
    const ignored = ".claude/skills/ignored"
    const outside = "../outside/skills/external"
    for (const [rel, text] of [
      [
        `${added}/SKILL.md`,
        "---\nname: arrived\ndescription: Newly installed.\n---\n",
      ],
      [`${added}/docs/guide.md`, "Use /arrived.\n"],
      [`${added}/private.md`, "Use /arrived.\n"],
      [
        `${ignored}/SKILL.md`,
        "---\nname: ignored\ndescription: Ignored skill.\n---\n",
      ],
      [
        `${outside}/SKILL.md`,
        "---\nname: external\ndescription: Outside skill.\n---\n",
      ],
    ] as const) {
      const path = join(root, rel)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text)
    }
    await client.conn.sendNotification(DidChangeWatchedFilesNotification.type, {
      changes: [added, ignored, outside].map(
        (rel): FileEvent => ({
          type: FileChangeType.Created,
          uri: client.uriFor(rel),
        })
      ),
    })

    expect(
      asLocations(
        await client.definition("AGENTS.md", { character: 7, line: 0 })
      ).map(({ uri }) => uri)
    ).toEqual([client.uriFor(`${added}/SKILL.md`)])
    expect(
      completionItemsOf(
        await client.completion("AGENTS.md", { character: 5, line: 1 })
      ).map(({ label }) => label)
    ).toEqual(["arrived"])
    const references = await client.references("AGENTS.md", {
      character: 7,
      line: 0,
    })
    expect(new Set(references?.map(({ uri }) => uri))).toEqual(
      new Set([
        client.uriFor("AGENTS.md"),
        client.uriFor(`${added}/docs/guide.md`),
      ])
    )
  } finally {
    client.stop()
    rmSync(temp, { force: true, recursive: true })
  }
})

for (const [directory, dynamicRegistration] of [
  ["project", true],
  ["skills", true],
  ["skills", false],
] as const) {
  test(`folder watching in ${directory} negotiates dynamic registration ${dynamicRegistration}`, async () => {
    const temp = mkdtempSync(join(tmpdir(), "skill-watch-registration-"))
    const root = join(temp, directory)
    mkdirSync(root)
    const client = await Client.start(root, {
      workspace: { didChangeWatchedFiles: { dynamicRegistration } },
    })
    try {
      await client.settle()
      expect(client.registrations).toEqual(
        dynamicRegistration
          ? [
              expect.objectContaining({
                method: "workspace/didChangeWatchedFiles",
                registerOptions: {
                  watchers: [
                    { globPattern: "**/*.md" },
                    { globPattern: "**/.skillignore" },
                    { globPattern: "**/skills/*" },
                    ...(directory === "skills" ? [{ globPattern: "*" }] : []),
                  ],
                },
              }),
            ]
          : []
      )
    } finally {
      client.stop()
      rmSync(temp, { force: true, recursive: true })
    }
  })
}

for (const change of [
  FileChangeType.Created,
  FileChangeType.Changed,
] as const) {
  test(`non-Markdown files stay unindexed after watched-file event ${change}`, async () => {
    const temp = mkdtempSync(join(tmpdir(), "skill-watch-non-markdown-"))
    const root = join(temp, "skills")
    mkdirSync(join(root, "shipping"), { recursive: true })
    writeFileSync(
      join(root, "shipping/SKILL.md"),
      "---\nname: shipping\ndescription: A watched-file test skill.\n---\n"
    )
    writeFileSync(join(root, "notes.md"), "Use /shipping.\n")
    writeFileSync(join(root, "notes.txt"), "Use /shipping and /unknown.\n")
    const client = await Client.start(root)
    try {
      await client.conn.sendNotification(
        DidChangeWatchedFilesNotification.type,
        {
          changes: [{ type: change, uri: client.uriFor("notes.txt") }],
        }
      )
      await client.settle()
      expect(
        client.publishLog.some(({ uri }) => uri === client.uriFor("notes.txt"))
      ).toBe(false)
      expect(
        (await client.references("notes.md", { character: 7, line: 0 }))?.map(
          ({ uri }) => uri
        )
      ).toEqual([client.uriFor("notes.md")])
    } finally {
      client.stop()
      rmSync(temp, { force: true, recursive: true })
    }
  })
}
