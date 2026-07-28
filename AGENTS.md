## What this is

An LSP server for agent skill files (`skills/<name>/SKILL.md`): go-to-definition,
find-references, completion, diagnostics, and cross-file rename for `/skill-name`
and `$skill-name` references. Rename is the flagship feature — one `WorkspaceEdit`
renames the skill folder (`RenameFile`), the frontmatter `name:` value, and every
reference across the workspace.

**The test suite is the contract.** Definition of done: `bun install` +
`just check` all clean — run them, never grade from memory. Spec
decisions live in this file and in the tests; change tests only when the spec
itself changes, stated out loud, never to make an implementation pass.

## Commands

Tools come from mise (`mise trust && mise install` on first checkout).

| Command      | What                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `bun test`   | Full suite; single file: `bun test tests/rename.test.ts`; single test: `bun test -t "rename rejects"` |
| `just check` | tsc (root + vscode-extension) + ultracite lint + the full test suite                                  |
| `just fmt`   | ultracite fix --unsafe — ALWAYS use this instead of fixing format/lint complaints by hand             |
| `just build` | All artifacts into dist/: standalone binary, VS Code .vsix, Zed wasm                                  |
| `just bin`   | Build + install server binary to ~/.local/bin/skill-language-server (what Zed launches)               |

Verifier = `bun install` + `just check` all clean. Run it before
declaring anything done. After server changes, refresh installed clients:
`just bin` (Zed) and `just build && code --install-extension dist/skill-language-server.vsix`
(VS Code).

TypeScript is v7 (native compiler): `@types/*` packages must be listed
explicitly in each tsconfig's `"types"` field — they are not auto-discovered.

## Coding style

Formatting/lint is ultracite's job — `just fmt`, never hand-fix. The
conventions a formatter can't see are written down in `docs/typescript.md`
(function shape, naming, arktype/arkregex/es-toolkit idioms, the tsc-v7
never-CFA gotcha) and `docs/bun.md` (Bun `$`/`Bun.file` idioms for
`scripts/`). Read them before writing code. The load-bearing boundary:
`src/` and `ext/` must stay Node-compatible (`node:*` imports only, no Bun
globals — they ship to npm, the VS Code extension host, and Zed's Node);
`scripts/` is Bun-native and typechecked via the root tsconfig.

## Architecture

Three server modules in `src/`, each a layer:

- **parse.ts** — pure text → `{frontmatter, tokens}`. Owns the token grammar:
  `[/$]` + `[a-z0-9_]` segments joined by runs of `-` or `:` (separators may
  repeat but never lead/trail), rejected when preceded by a word/path/scheme/home
  char (`~` included, so `~/scripts` never matches) or followed by `/` (so
  `/usr/bin`, `$PATH`, `https://x` never match). Fenced code blocks are skipped
  with CommonMark pairing — only a closer with the same marker char and at
  least the opening length ends a fence (a `~~~` line inside a ``` block is
  content); inline code spans are NOT (people write `` `/skill` `` in prose).
  Frontmatter delimiter and YAML semantics are gray-matter's: delimiters sit
  at column 0, and an indented `---` in a block scalar is content; fields are
  salvaged per key, so one wrong-typed field
  never erases the others; the `name:` range anchors to the YAML-parsed value
  (quotes and trailing comments stay outside it) so diagnostics/renames target
  it exactly.
- **workspace.ts** — the index. Walks the workspace once (`scan()`), keyed maps
  `files` (by URI) and `skills` (by name, array-valued to track duplicates).
  All disk I/O is async (`node:fs/promises`); only `indexFile` (pure text →
  index) is sync. The walker follows symlinks — indexing the SYMLINK-side
  path, never the target — with an ancestor-chain `realpath` guard (not a
  global visited set: two non-cyclic routes to the same dir are both legal;
  only a loop back into an ancestor terminates). Broken symlinks are skipped
  silently.
  Scope rule lives in `inScope()`: a file is indexed iff its path contains a
  `.claude`, `.agents`, `.codex`, or `skills` segment (or is named CLAUDE.md /
  AGENTS.md) AND is not matched by a workspace-root `.skillignore` (gitignore
  syntax; live-reloaded via the file watcher). This repo's own `.skillignore`
  excludes `tests/fixtures/` so fixture skills don't pollute editors opening
  this repo. Skill identity is the FOLDER name; frontmatter `name:` disagreeing
  is a diagnostic, not an alias. Duplicate names track every twin: a position
  on a declaration resolves to the twin defined in THAT file (rename from a
  duplicate's frontmatter renames its own folder), while references resolve to
  the first-indexed twin. All reported ranges cover the name part only,
  never the sigil. Unresolved `/references` get info-level hints, near misses
  (edit distance ≤ 2) upgrade to _did you mean_ warnings; builtin CLI command
  names (`src/builtins.ts`) and workspace `.claude/commands`/`.codex/prompts`
  names are exempt from both; `$` tokens get near-miss warnings but never the
  info hint.
- **server.ts** — LSP wiring only; no logic that isn't protocol shaped. Rename
  emits text edits BEFORE the folder `RenameFile` (clients apply sequentially;
  the frontmatter edit targets a file inside the folder being renamed).
  `RenameFile` is gated on the client declaring EITHER
  `workspaceEdit.documentChanges` OR `resourceOperations: ["rename"]` — Neovim
  only declares the latter; a client declaring neither gets a plain `changes`
  map (per spec that's all it supports). Renaming to the current name is a
  no-op (`null`), never a self-`RenameFile`. `willRenameFiles` handles
  explorer-drag renames (returns compensating edits, no `RenameFile` echo).
  Open buffers are authoritative over disk until `didClose`, which reverts to
  disk truth (an unsaved close leaves no watcher event). The watcher also
  registers `**/skills/*` because a recursive folder delete arrives as one
  event for the folder itself, which `**/*.md` never matches. Completion items
  carry an explicit `textEdit` — `-`/`:` are word delimiters in markdown, so
  client-side word replacement would mangle multi-segment names. Diagnostics
  are published ONLY when non-empty, plus exactly one clearing empty publish
  when a URI transitions back to clean — clean files are never published
  (Neovim materializes a phantom buffer per published URI). All sends route
  through the one `publish()` helper. Because index mutations are async, a
  single promise-chain queue serializes them: notification handlers enqueue,
  every request handler awaits the queue tail first — this is what makes a
  request round-trip (the test harness's `settle()`) prove that all earlier
  notifications' effects, including publishes, have landed.

Tests are protocol-level, not unit-level: `tests/harness.ts` boots the real
server over in-memory streams and speaks JSON-RPC to it. `tests/corpus.ts` is
the ground truth of every reference in the fixture workspace
(`tests/fixtures/workspace/`) — if you add/move a reference in a fixture,
update corpus.ts, not individual test expectations. Fixtures encode the edge
cases deliberately (near-miss typo, fenced block, inline code, out-of-scope
`docs/guide.md`, duplicate `deploy` skills, builtin-shadowing `modal` skill,
custom command files); don't "clean them up".

Distribution targets in `ext/` (thin shims around the same server):

- `ext/vscode/` — bundles the server INTO the .vsix (dist/server.js),
  spawns it over IPC. Attaches to all markdown; the server self-filters.
- `ext/zed/` — Rust/WASM shim. Prefers `skill-language-server` on PATH (the
  `just bin` dev workflow); otherwise auto-installs the npm package into the
  extension's work dir and runs it on Zed's bundled Node (needs engines
  `>=22`, which Zed's runtime satisfies — don't tighten it). Installed as a
  dev extension via `zed: install dev extension`.
- `ext/nvim/` — plain Lua plugin for Neovim 0.11+ (`lsp/skill-language-server.lua` +
  `vim.lsp.enable`); expects the `just bin` binary on PATH.
