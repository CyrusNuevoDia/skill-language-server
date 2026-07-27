# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An LSP server for agent skill files (`skills/<name>/SKILL.md`): go-to-definition,
find-references, completion, diagnostics, and cross-file rename for `/skill-name`
and `$skill-name` references. Rename is the flagship feature — one `WorkspaceEdit`
renames the skill folder (`RenameFile`), the frontmatter `name:` value, and every
reference across the workspace.

**The test suite is the contract.** Definition of done: `bun install` +
`just check` + `bun test` all clean — run them, never grade from memory. Spec
decisions live in this file and in the tests; change tests only when the spec
itself changes, stated out loud, never to make an implementation pass.

## Commands

Tools come from mise (`mise trust && mise install` on first checkout).

| Command | What |
| --- | --- |
| `bun test` | Full suite; single file: `bun test tests/rename.test.ts`; single test: `bun test -t "rename rejects"` |
| `just check` | tsc (root + vscode-extension) + ultracite lint |
| `just fmt` | ultracite fix --unsafe — ALWAYS use this instead of fixing format/lint complaints by hand |
| `just build` | All artifacts into dist/: standalone binary, VS Code .vsix, Zed wasm |
| `just bin` | Build + install server binary to ~/.local/bin/skill-language-server (what Zed launches) |

Verifier = `bun install` + `just check` + `bun test` all clean. Run it before
declaring anything done. After server changes, refresh installed clients:
`just bin` (Zed) and `just build && code --install-extension dist/skill-language-server.vsix`
(VS Code).

TypeScript is v7 (native compiler): `@types/*` packages must be listed
explicitly in each tsconfig's `"types"` field — they are not auto-discovered.

## Architecture

Three server modules in `src/`, each a layer:

- **parse.ts** — pure text → `{frontmatter, tokens}`. Owns the token grammar:
  `[/$]` + `[a-z0-9_]` segments joined by runs of `-` or `:` (separators may
  repeat but never lead/trail), rejected when preceded by a word/path/scheme
  char or followed by `/` (so `/usr/bin`, `$PATH`, `https://x` never match). Fenced code blocks are skipped;
  inline code spans are NOT (people write `` `/skill` `` in prose). Frontmatter
  ranges point at the `name:` value so diagnostics/renames target it exactly.
- **workspace.ts** — the index. Walks the workspace once (`scan()`), keyed maps
  `files` (by URI) and `skills` (by name, array-valued to track duplicates).
  Scope rule lives in `inScope()`: a file is indexed iff its path contains a
  `.claude`, `.agents`, `.codex`, or `skills` segment (or is named CLAUDE.md /
  AGENTS.md) AND is not matched by a workspace-root `.skillignore` (gitignore
  syntax; live-reloaded via the file watcher). This repo's own `.skillignore`
  excludes `tests/fixtures/` so fixture skills don't pollute editors opening
  this repo. Skill identity is the FOLDER name; frontmatter `name:` disagreeing
  is a diagnostic, not an alias. All reported ranges cover the name part only,
  never the sigil.
- **server.ts** — LSP wiring only; no logic that isn't protocol shaped. Rename
  emits text edits BEFORE the folder `RenameFile` (clients apply sequentially;
  the frontmatter edit targets a file inside the folder being renamed).
  `RenameFile` is gated on the client declaring EITHER
  `workspaceEdit.documentChanges` OR `resourceOperations: ["rename"]` — Neovim
  only declares the latter. `willRenameFiles` handles explorer-drag renames
  (returns compensating edits, no `RenameFile` echo).

Tests are protocol-level, not unit-level: `tests/harness.ts` boots the real
server over in-memory streams and speaks JSON-RPC to it. `tests/corpus.ts` is
the ground truth of every reference in the fixture workspace
(`tests/fixtures/workspace/`) — if you add/move a reference in a fixture,
update corpus.ts, not individual test expectations. Fixtures encode the edge
cases deliberately (near-miss typo, fenced block, inline code, out-of-scope
`docs/guide.md`, duplicate `deploy` skills); don't "clean them up".

Distribution targets in `ext/` (thin shims around the same server):

- `ext/vscode/` — bundles the server INTO the .vsix (dist/server.js),
  spawns it over IPC. Attaches to all markdown; the server self-filters.
- `ext/zed/` — Rust/WASM shim that launches `skill-language-server` from PATH
  (falls back to ~/.local/bin). Installed as a dev extension via
  `zed: install dev extension`.
- `ext/nvim/` — plain Lua plugin for Neovim 0.11+ (`lsp/skill-language-server.lua` +
  `vim.lsp.enable`); expects the `just bin` binary on PATH.
