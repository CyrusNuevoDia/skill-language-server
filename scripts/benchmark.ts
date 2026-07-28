// Benchmark the server's core operations: scan() end-to-end plus the pure
// stages behind it (parseDoc, indexFile) and the index queries (diagnostics,
// references). Synthetic corpora are generated once into the OS temp dir and
// reused across runs, so before/after comparisons measure the code, not the
// corpus. Usage: just bench or bun scripts/benchmark.ts
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bench, run } from "mitata"
import { parseDoc } from "@/parse"
import { uriOf } from "@/utils"
import { Workspace } from "@/workspace"

/** Bump to force corpus regeneration after changing the generators below. */
const CORPUS_VERSION = "1"

type Corpus = {
  name: string
  /** Out-of-scope files: walked by the traversal but never read or parsed. */
  notes: number
  skills: number
}

const MEDIUM: Corpus = { name: "medium", notes: 100, skills: 100 }
const LARGE: Corpus = { name: "large", notes: 500, skills: 500 }
const CORPORA = [MEDIUM, LARGE]
const COMMAND_COUNT = 5
const PARSE_BATCH = 100
const REFERENCE_BATCH = 100

const PROSE = `This paragraph pads the file to a realistic size so parsing cost
reflects real skill documents rather than three-line stubs. Paths like
/usr/bin and $PATH and https://example.com must never parse as tokens,
and neither should ~/scripts/setup.sh or the price of $5.`

const ref = (n: number, total: number) =>
  `/skill-${((n % total) + total) % total}`

function oddityFor(i: number, total: number): string {
  if (i % 25 === 0) {
    return `A stray /completely-unrelated-name-${i} reference.`
  }
  if (i % 10 === 0) {
    return `A typo reference to /skil-${i}.`
  }
  return `See also ${ref(i * 3, total)}.`
}

const skillDoc = (i: number, total: number) => `---
name: skill-${i}
description: Synthetic benchmark skill ${i}
---

# skill-${i}

Run ${ref(i + 1, total)} before this one, then ${ref(i + 2, total)}.
The dollar flavor is $skill-${(i + 7) % total}, and /cmd-1 is a command.

${PROSE}

\`\`\`bash
# fenced references never count: /skill-${i} --dry-run
~~~ still inside the fence
\`\`\`

${oddityFor(i, total)}

${PROSE}

Finish with ${ref(i - 1, total)}.
`

const noteDoc = (i: number) => `# Note ${i}

Out of scope: walked by the traversal, never indexed.
`

const commandDoc = (k: number) => `# cmd-${k}

A custom command file; /cmd-${k} references are exempt.
`

const rootMemoryDoc = (total: number) => `# Agent memory

${Array.from(
  { length: Math.min(50, total) },
  (_, i) => `- ${ref(i, total)} handles case ${i}, per /cmd-1.`
).join("\n")}
`

async function buildCorpus(dir: string, corpus: Corpus): Promise<void> {
  const marker = Bun.file(join(dir, ".complete"))
  if ((await marker.exists()) && (await marker.text()) === CORPUS_VERSION) {
    return
  }
  await rm(dir, { force: true, recursive: true })
  const writes = [
    ...Array.from({ length: corpus.skills }, (_, i) =>
      Bun.write(
        join(dir, "skills", `skill-${i}`, "SKILL.md"),
        skillDoc(i, corpus.skills)
      )
    ),
    ...Array.from({ length: corpus.notes }, (_, i) =>
      Bun.write(
        join(dir, "notes", `pocket-${i % 10}`, "deeper", `note-${i}.md`),
        noteDoc(i)
      )
    ),
    ...Array.from({ length: COMMAND_COUNT }, (_, k) =>
      Bun.write(join(dir, ".claude", "commands", `cmd-${k}.md`), commandDoc(k))
    ),
    Bun.write(join(dir, "CLAUDE.md"), rootMemoryDoc(corpus.skills)),
    Bun.write(join(dir, "AGENTS.md"), rootMemoryDoc(corpus.skills)),
  ]
  await Promise.all(writes)
  await Bun.write(marker, CORPUS_VERSION)
}

async function registerCorpusScan(
  benchRoot: string,
  corpus: Corpus
): Promise<void> {
  const dir = join(benchRoot, corpus.name)
  await buildCorpus(dir, corpus)
  const probe = new Workspace(uriOf(dir))
  await probe.scan()
  bench(
    `scan: ${corpus.name} (${probe.files.size} indexed, ${corpus.notes} out-of-scope)`,
    () => new Workspace(uriOf(dir)).scan()
  )
}

async function main() {
  const benchRoot = join(tmpdir(), "skill-ls-bench")
  const fixtureRoot = join(
    import.meta.dir,
    "..",
    "tests",
    "fixtures",
    "workspace"
  )

  bench("scan: fixture workspace", () =>
    new Workspace(uriOf(fixtureRoot)).scan()
  )
  for (const corpus of CORPORA) {
    // biome-ignore lint/performance/noAwaitInLoops: corpus setup and registration order must remain sequential
    await registerCorpusScan(benchRoot, corpus)
  }

  const large = new Workspace(uriOf(join(benchRoot, LARGE.name)))
  await large.scan()
  const texts = await Promise.all(
    [...large.files.values()].map(async (file) => ({
      path: file.path,
      text: await Bun.file(file.path).text(),
    }))
  )
  const sampleDoc = skillDoc(3, LARGE.skills)

  function parseBatch(): void {
    for (let i = 0; i < PARSE_BATCH; i += 1) {
      parseDoc(sampleDoc)
    }
  }
  function indexAll(): void {
    for (const { path, text } of texts) {
      large.indexFile(path, text)
    }
  }
  function referenceBatch(): void {
    for (let i = 0; i < REFERENCE_BATCH; i += 1) {
      large.referencesTo(`skill-${i}`)
    }
  }

  bench(`parseDoc: one SKILL.md x${PARSE_BATCH}`, parseBatch)
  bench(`indexFile: all ${texts.length} large files (sync)`, indexAll)
  bench("diagnosticsByURI: large", () => large.diagnosticsByURI())
  bench(`referencesTo: x${REFERENCE_BATCH} lookups (large)`, referenceBatch)
  await run({ throw: true })
}

await main()
