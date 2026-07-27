# skill-lsp

[![npm](https://img.shields.io/npm/v/skill-language-server)](https://www.npmjs.com/package/skill-language-server)
[![CI](https://github.com/CyrusNuevoDia/skill-language-server/actions/workflows/ci.yml/badge.svg)](https://github.com/CyrusNuevoDia/skill-language-server/actions/workflows/ci.yml)

**Rename an agent skill once — the folder, the frontmatter, and every reference across your workspace update together.** A language server for SKILL.md files. Works in VS Code, Zed, Neovim, and Helix.

Agent skills are markdown files that reference each other — `/ship`, `$verify` (the sigil varies by agent; both mean the same thing) — from other skills, `CLAUDE.md`/`AGENTS.md` memory files, and agent definitions. That's a real dependency graph with all the refactoring hazards of code and none of the tooling: rename a skill by hand and you're editing a folder name, a `name:` field, and every reference that mentions it, hoping you found them all. skill-lsp gives skill files the ergonomics TypeScript gives symbols:

- **Rename** (`F2`) — one `WorkspaceEdit` renames the skill folder, the frontmatter `name:` value, and every reference, applied by your editor as a single undo step. Works from a reference token, from the frontmatter, or by renaming the folder in your file explorer.
- **Go to definition** — cmd-click `/skill-name` jumps to its SKILL.md.
- **Find references** — every mention of a skill across skills, memory files, and agent files.
- **Diagnostics** — typo'd references get a *did you mean* suggestion; missing or mismatched frontmatter `name:` fields and duplicate skill names get flagged.
- **Completion** — type `/` or `$` and get every skill with its description.
- **Highlighting & links** — resolved references get semantic-token coloring (editors that support it) and are clickable document links everywhere; typos conspicuously stay plain.

It stays quiet where markdown demands it: fenced code blocks are never parsed — no references, no diagnostics, no completion popups (indented code blocks aren't detected; use fences). Multi-segment paths like `/usr/bin` and uppercase shell vars like `$PATH` are never references, and completion follows the same boundary rules, so typing `docs/` won't pop the skill list. Inline code spans *do* count — that's how people write skill names in prose — and unknown names produce nothing.

skill-lsp is a language server, not a linter — pair it with `skill-lint` or `agnix` if you also want structural/security linting for your skills.

## Install

The server for Zed, Neovim, and Helix:

```sh
npm install -g skill-language-server   # puts the `skill-lsp` binary on your PATH
```

Or from a clone of this repo:

```sh
mise trust && mise install   # toolchain: bun, just (rust too, used only for the Zed wasm)
bun install                  # project dependencies
just bin                     # → ~/.local/bin/skill-lsp; keep that on your PATH
```

VS Code needs neither: its extension bundles the server.

### VS Code

```sh
just build-vscode
code --install-extension dist/skill-lsp.vsix
```

### Zed

One-time: command palette → `zed: install dev extension` → select `ext/zed/`. After server updates: `just bin`, then `editor: restart language server`.

### Neovim (0.11+)

```lua
-- lazy.nvim
{ dir = "/path/to/skill-lsp/ext/nvim" }
```

Or copy `ext/nvim/lsp/skill-lsp.lua` into `~/.config/nvim/lsp/` and add `vim.lsp.enable("skill-lsp")` to your init.lua.

### Helix

```toml
# languages.toml
[language-server.skill-lsp]
command = "skill-lsp"
args = ["--stdio"]

[[language]]
name = "markdown"
language-servers = ["skill-lsp"]  # add e.g. "marksman" here if you use it
```

## How it scans

- **Skills are defined** by any `**/skills/<name>/SKILL.md` in the workspace. The folder name is the skill's canonical name; a missing or disagreeing frontmatter `name:` is an error, not an alias.
- **References are scanned** in every `.md` file under `.claude/`, `.agents/`, `.codex/`, or any `skills/` directory, plus every `CLAUDE.md` and `AGENTS.md` anywhere in the tree. Markdown elsewhere is never touched — a rename can't rewrite your blog posts.
- **The index stays live** where the editor supports LSP file watching: on-disk creates, edits, and deletes update it, with open buffers always authoritative over disk. Editors without watching catch up when you open a file or restart the server.
- **`.skillignore`** (gitignore syntax, workspace root) excludes paths from everything: indexing, references, rename, diagnostics, completion. Edits to it trigger a rescan under file watching; otherwise it's re-read on restart. This repo ignores its own `tests/fixtures/` that way.
- Multi-root workspaces: only the first workspace folder is indexed, for now.

## Client compatibility

Rename-with-folder-move relies on LSP resource operations. Checked against client source as of 2026-07: VS Code, Zed, Helix, and Neovim all apply directory `RenameFile` operations. Behavioral notes: the server emits `documentChanges` when a client declares *either* `documentChanges` or `resourceOperations: ["rename"]`, because Neovim only declares the latter; and Neovim never sends `willRenameFiles`, so explorer-drag renames don't rewrite references there — rename from a token or the frontmatter instead.

Live index updates vary by editor: VS Code and Zed watch the filesystem; Neovim does too, except on Linux where it's off by default; Helix declares the capability but only reports changes made through Helix itself, so edits by other tools need a file reopen or a server restart there.

## Development

```sh
just check   # tsc (server + VS Code extension) + ultracite lint
bun test     # protocol-level tests against a fixture workspace
just build   # everything into dist/ — binary, .vsix, Zed wasm (wasm needs rust)
just fmt     # ultracite fix --unsafe
```

The test suite is the contract: `tests/harness.ts` boots the real server over in-memory streams and speaks JSON-RPC to it; `tests/corpus.ts` holds the ground-truth reference set for the fixture workspace. Work is done when `just check` and `bun test` are green — the suite was written before the server was.

Architecture is three small layers in `src/`: `parse.ts` (frontmatter + token grammar), `workspace.ts` (the index), `server.ts` (LSP wiring). Editor shims live in `ext/{vscode,zed,nvim}`.

Releases use [changesets](https://github.com/changesets/changesets): run `bun changeset` alongside your change (CI fails PRs that touch release inputs without one), merge to main, and the release workflow versions, publishes to npm via OIDC trusted publishing, and tags — no manual publish step.

## License

MIT
