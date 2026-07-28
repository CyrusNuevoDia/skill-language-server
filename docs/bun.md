# Bun style

Idioms for `scripts/`, which runs under `bun` directly (CI invokes
`bun scripts/<name>.ts`). Unlike `src/` and `ext/`, these files never ship
to a Node runtime, so Bun APIs are the default, not a portability risk.
General TypeScript conventions still apply — see
[typescript.md](./typescript.md).

## Shell

Use Bun's `$` instead of `node:child_process`:

```ts
import { $ } from "bun"

const git = async (...args: string[]) => (await $`git ${args}`.text()).trimEnd()
```

- An interpolated array becomes one escaped argv entry per element — no
  shell injection, and no glob expansion, so `".changeset/*.md"` reaches git
  as a literal pattern.
- `.text()` implies `.quiet()`; don't stack both.
- `$` **throws on non-zero exit** by default. The uncaught `ShellError`
  prints the failing call site, exit code, and captured stderr, then exits 1
  — that is the error handling. Don't wrap calls in try/catch to re-print a
  worse version of the same information.
- Where failure is an expected outcome with a fallback, catch inline in a
  `??` chain:

  ```ts
  const mergeBase =
    (await git("merge-base", "HEAD", `origin/${base}`).catch(() => undefined)) ??
    "HEAD"
  ```

- Reach for `.nothrow()` only when the exit code itself is the data.

## Files

`Bun.file(path).text()` over `node:fs/promises`. It's lazy, typed, and reads
as one expression inside a map:

```ts
const readChangedChangesets = (filePaths: string[]) =>
  Promise.all(
    filePaths.map(async (filePath) =>
      parseChangeset(await Bun.file(filePath).text(), filePath)
    )
  )
```

## Script anatomy

One file, one job, `async function main()` + top-level `await main()`.
Domain failures (bad input, policy violations) go through a
`fail(message): never` helper — a clean message on stderr and exit 1, no
stack trace. Infrastructure failures (git missing, file unreadable) just
throw; the runtime's error report is better than anything hand-rolled.

Scripts are typechecked by the root tsconfig (`scripts/` is in `include`)
and linted by ultracite like everything else — `just check` covers them.
