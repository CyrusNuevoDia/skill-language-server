# TypeScript style

How TypeScript is written in this repo — `src/`, `ext/`, `tests/`, and
`scripts/` alike. Formatting and mechanical lint are ultracite's job
(`just fmt`, never hand-fix); this doc covers the conventions a formatter
can't see. Bun-only idioms for `scripts/` live in [bun.md](./bun.md).

## Runtime boundary

`src/` and `ext/` ship to Node runtimes — the npm `bin`, the VS Code
extension host, Zed's bundled Node (engines `>=22`). They may import
`node:*` builtins only: no Bun globals, no `bun:` imports. `scripts/` runs
under Bun exclusively and is exempt.

## Function shape

`const fn = (...) =>` is reserved for single-expression implicit returns —
including multi-line chains, as long as the body is one expression:

```ts
const parseableChangesetPaths = (changesets: ChangedFile[]) =>
  uniq(
    changesets
      .filter((changeset) => changeset.status !== "D")
      .map(currentPath)
      .filter(isChangesetPath)
  ).toSorted()
```

Anything needing a block body — statements, guards, early returns — is a
`function` declaration. No `const fn = (...) => { ... }`.

One hard rule inside that: **never-returning helpers must be `function`
declarations.** tsc v7's control-flow analysis does not terminate branches
after a call to a const-arrow `never` function, so an arrow `fail` silently
breaks narrowing at every call site:

```ts
function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
```

## Naming

- `CONSTANT_CASE` for top-level value constants: `NAME_PATTERN`,
  `ZERO_RANGE`, `RELEASE_INPUT_FILES`.
- `PascalCase` for arktype Types, which do double duty as values and types:
  `const ChangeStatus = type(...)` + `type ChangeStatus = typeof ChangeStatus.infer`.
- `camelCase` for everything else. Acronyms stay uppercase (`parseYAML`,
  `uriOf` → `URI` in types), except the `Id` suffix (`userId`, never `userID`).

## Types

- `type` aliases, never `interface` (lint-enforced).
- Encode invariants in the type instead of re-guarding at every use. A list
  that is checked non-empty once is `[string, ...string[]]` from then on —
  the undefined-checks downstream disappear.
- Runtime validation is arktype: `Type.allows(x)` is a type guard,
  `typeof T.infer` is the static type. Don't hand-roll validators next to a
  hand-written type that can drift.

## Libraries

- **arkregex** over raw `RegExp` for patterns worth validating: patterns are
  checked at the type level (it will reject an unnecessary `\/` escape at
  compile time). Caveat: `exec()` returns a typed record, not a real array —
  it is not iterable, so array destructuring fails. Use numeric-key object
  destructuring: `const { 1: name, 2: value } = match`.
- **es-toolkit** before hand-rolling collection helpers (`uniq`, etc.).
- Prefer non-mutating methods: `.toSorted()`, not `.sort()` (lib is ES2023).

## tsc v7

TypeScript is the native-compiler preview. Two consequences beyond the CFA
rule above: `@types/*` packages must be listed explicitly in each tsconfig's
`"types"` field (not auto-discovered), and every directory that should stay
honest must be in a tsconfig `include` — `scripts/` is in the root one; a
file outside `include` is a file that has never been typechecked.
