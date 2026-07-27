# skill-language-server

[![npm](https://img.shields.io/npm/v/skill-language-server)](https://www.npmjs.com/package/skill-language-server)
[![CI](https://github.com/CyrusNuevoDia/skill-language-server/actions/workflows/ci.yml/badge.svg)](https://github.com/CyrusNuevoDia/skill-language-server/actions/workflows/ci.yml)

**Rename an agent skill once — the folder, the frontmatter, and every reference across your workspace update together.** A language server for agent skills and the files that reference them. Works in VS Code, Zed, Neovim, and Helix.

Your skills, `CLAUDE.md`/`AGENTS.md` memory files, and agent definitions reference each other by name — `/ship`, `$verify` — a real dependency graph with all the refactoring hazards of code and none of the tooling. Rename a skill by hand and every stale reference keeps looking like ordinary prose: nothing errors, the agent just silently stops loading the skill, and you find out mid-session. skill-language-server makes those names real symbols, with the ergonomics TypeScript gives code:

- **Rename** (`F2`) — one `WorkspaceEdit` renames the skill folder, the frontmatter `name:` value, and every reference, applied by your editor as a single undo step. Works from a reference token, from the frontmatter, or by renaming the folder in your file explorer.
- **Go to definition** — cmd-click `/skill-name` jumps to its SKILL.md.
- **Find references** — every mention of a skill across skills, memory files, and agent files.
- **Diagnostics** — near-miss references get a *did you mean* warning and other unresolved `/references` a quiet info hint; missing or mismatched frontmatter `name:` fields and duplicate skill names get flagged. Built-in commands (`/help`, `/compact`, …) and your own `.claude/commands`/`.codex/prompts` are recognized as commands, never flagged as skills.
- **Completion** — type `/` or `$` and get every skill with its description.
- **Highlighting & links** — resolved references get semantic-token coloring (editors that support it) and are clickable document links everywhere; unresolved names conspicuously stay plain.

It's quiet by design — a false reference in prose costs more than a missed one. Fenced code blocks are never parsed: no references, no diagnostics, no completion popups. Multi-segment paths like `/usr/bin` and uppercase shell vars like `$PATH` are never references, and typing `docs/` won't pop the skill list. Inline code spans *do* count — that's how people write skill names in prose. One crisp rule for typos: a near miss of a real skill (edit distance ≤ 2) gets a *did you mean* warning; any other unresolved `/name` gets an info-level hint — unless it's a built-in CLI command or one of your own `.claude/commands`/`.codex/prompts`, which are commands, not skills, and never flagged. Unresolved `$names` stay silent entirely: too much ordinary prose (`$5`, `$my_var`) looks like them. (Indented code blocks aren't detected as code; use fences.)

skill-language-server is a language server, not a linter — pair it with `skill-lint` or `agnix` if you also want structural/security linting for your skills.

## Install

Helix and Neovim need only the server binary from npm plus the config below. Zed needs the binary plus a one-time clone of this repo for its extension shim. VS Code needs only a clone — the .vsix bundles the server (marketplace listing pending).

```sh
npm install -g skill-language-server   # puts the `skill-language-server` binary on your PATH
```

To see it work once your editor is wired up: put the cursor on any `/skill-name` reference, hit `F2`, type a new name — the folder, the frontmatter `name:`, and every reference across the workspace update as one undo step.

### Helix

```toml
# languages.toml
[language-server.skill-language-server]
command = "skill-language-server"
args = ["--stdio"]

[[language]]
name = "markdown"
language-servers = ["skill-language-server"]  # add e.g. "marksman" here if you use it
```

### Neovim (0.11+)

Create `~/.config/nvim/lsp/skill-language-server.lua`:

```lua
return {
  cmd = { "skill-language-server", "--stdio" },
  filetypes = { "markdown" },
  root_markers = { ".claude", ".git" },
}
```

and add `vim.lsp.enable("skill-language-server")` to your init.lua. (From a clone, the same config ships as a plugin: `{ dir = "/path/to/skill-language-server/ext/nvim" }` in lazy.nvim.)

### Zed

One-time, from a clone: command palette → `zed: install dev extension` → select `ext/zed/`. After updating the server (`npm update -g skill-language-server`, or `just bin` from source): `editor: restart language server`.

### VS Code

From a clone:

```sh
mise trust && mise install && bun install
just build-vscode
code --install-extension dist/skill-language-server.vsix
```

### From source

The server itself, without npm:

```sh
mise trust && mise install   # toolchain: bun, just (rust too, used only for the Zed wasm)
bun install                  # project dependencies
just bin                     # → ~/.local/bin/skill-language-server; keep that on your PATH
```

## How it scans

The server's world is the folder your editor opened: it walks that tree once at startup, indexes every skill and reference inside it, and never reads outside it. Open a repo and you get that repo's world — your global `~/.claude` is invisible from inside it, and vice versa; open `~/.claude` itself as a workspace to refactor the global library with the same machinery. Cross-workspace renames are a deliberate two-step: rename where the skill lives, then open the other workspace and rename its stragglers. The payoff for the boundary is the blast radius — a rename can never surprise you by editing another checkout or your home directory; it touches exactly the tree you have open.

Stale slash references left behind in that *other* workspace surface as info-level hints when you open it, and near misses of a real skill upgrade to a *did you mean* warning. Two blind spots remain: `$`-sigil stragglers stay silent, and so does an old name that doubles as a built-in command (rename a skill called `verify` away and stale `/verify` mentions read as the built-in).

Within a workspace:

- **Skills are defined** by any `**/skills/<name>/SKILL.md` in the workspace. The folder name is the skill's canonical name; a missing or disagreeing frontmatter `name:` is an error, not an alias.
- **References are scanned** in every `.md` file under `.claude/`, `.agents/`, `.codex/`, or any `skills/` directory, plus every `CLAUDE.md` and `AGENTS.md` anywhere in the tree. Markdown elsewhere is never touched — a rename can't rewrite your blog posts.
- **The index stays live** where the editor supports LSP file watching: on-disk creates, edits, and deletes update it, with open buffers always authoritative over disk. Editors without watching catch up when you open a file or restart the server.
- **`.skillignore`** (gitignore syntax, workspace root) excludes paths from everything: indexing, references, rename, diagnostics, completion. Edits to it trigger a rescan under file watching; otherwise it's re-read on restart. This repo ignores its own `tests/fixtures/` that way.
- Multi-root workspaces: only the first workspace folder is indexed.

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
