// Benchmark the server's core operations: scan() end-to-end plus the pure
// stages behind it (parseDoc, indexFile) and the index queries (diagnostics,
// references). Synthetic corpora are generated once into the OS temp dir and
// reused across runs, so before/after comparisons measure the code, not the
// corpus. Usage: bun scripts/benchmark.ts [results.json]
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseDoc } from "@/parse"
import { uriOf } from "@/utils"
import { Workspace } from "@/workspace"

/** Bump to force corpus regeneration after changing the generators below. */
const CORPUS_VERSION = "1"

type Corpus = {
  /** Timed scan() iterations (a fifth of this again as warmup). */
  iters: number
  name: string
  /** Out-of-scope files: walked by the traversal but never read or parsed. */
  notes: number
  skills: number
}

const MEDIUM: Corpus = { iters: 20, name: "medium", notes: 100, skills: 100 }
const LARGE: Corpus = { iters: 10, name: "large", notes: 500, skills: 500 }
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

type Stats = {
  iters: number
  max: number
  mean: number
  min: number
  p50: number
}
type Row = { name: string; stats: Stats }

async function bench(
  name: string,
  iters: number,
  fn: () => unknown
): Promise<Row> {
  const warmup = Math.max(2, Math.ceil(iters / 5))
  for (let i = 0; i < warmup; i += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: warmup runs must finish before sampling starts
    await fn()
  }
  const samples: number[] = []
  for (let i = 0; i < iters; i += 1) {
    const start = Bun.nanoseconds()
    // biome-ignore lint/performance/noAwaitInLoops: timing samples must not overlap
    await fn()
    samples.push((Bun.nanoseconds() - start) / 1e6)
  }
  const sorted = samples.toSorted((a, b) => a - b)
  return {
    name,
    stats: {
      iters,
      max: sorted.at(-1) ?? 0,
      mean: sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length,
      min: sorted[0] ?? 0,
      p50: sorted[Math.floor(sorted.length / 2)] ?? 0,
    },
  }
}

const ms = (value: number) => `${value.toFixed(3)}ms`.padStart(10)

function printTable(rows: Row[]): void {
  const nameWidth = Math.max(...rows.map((row) => row.name.length))
  const columns = ["min", "p50", "mean", "max"]
    .map((column) => column.padStart(10))
    .join(" ")
  console.log(`${"benchmark".padEnd(nameWidth)}  ${columns}  iters`)
  for (const { name, stats } of rows) {
    const cells = [stats.min, stats.p50, stats.mean, stats.max]
      .map(ms)
      .join(" ")
    console.log(`${name.padEnd(nameWidth)}  ${cells}  ${stats.iters}`)
  }
}

async function benchCorpusScan(
  benchRoot: string,
  corpus: Corpus
): Promise<Row> {
  const dir = join(benchRoot, corpus.name)
  await buildCorpus(dir, corpus)
  const probe = new Workspace(uriOf(dir))
  await probe.scan()
  return bench(
    `scan: ${corpus.name} (${probe.files.size} indexed, ${corpus.notes} out-of-scope)`,
    corpus.iters,
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
  const rows: Row[] = []

  rows.push(
    await bench("scan: fixture workspace", 40, () =>
      new Workspace(uriOf(fixtureRoot)).scan()
    )
  )
  for (const corpus of CORPORA) {
    // biome-ignore lint/performance/noAwaitInLoops: benchmarks must run one at a time
    rows.push(await benchCorpusScan(benchRoot, corpus))
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

  rows.push(
    await bench(`parseDoc: one SKILL.md x${PARSE_BATCH}`, 30, parseBatch)
  )
  rows.push(
    await bench(
      `indexFile: all ${texts.length} large files (sync)`,
      20,
      indexAll
    )
  )
  rows.push(
    await bench("diagnosticsByURI: large", 15, () => large.diagnosticsByURI())
  )
  rows.push(
    await bench(
      `referencesTo: x${REFERENCE_BATCH} lookups (large)`,
      20,
      referenceBatch
    )
  )

  printTable(rows)

  const [, , jsonPath] = process.argv
  if (jsonPath) {
    await Bun.write(jsonPath, `${JSON.stringify(rows, null, 2)}\n`)
    console.log(`\nwrote ${jsonPath}`)
  }
}

await main()
