# skill-language-server

[![npm](https://img.shields.io/npm/v/skill-language-server)](https://www.npmjs.com/package/skill-language-server)
[![Open VSX](https://img.shields.io/open-vsx/v/cyrusnewday/skill-language-server?label=Open%20VSX&color=C160EF)](https://open-vsx.org/extension/cyrusnewday/skill-language-server)
[![VS Marketplace](https://vsmarketplacebadges.dev/version-short/cyrusnewday.skill-language-server.svg?label=VS%20Marketplace&color=007ACC)](https://marketplace.visualstudio.com/items?itemName=cyrusnewday.skill-language-server)
[![Zed](https://img.shields.io/badge/Zed-extension-084CCF)](https://zed.dev/extensions/skill-language-server)
[![CI](https://github.com/CyrusNuevoDia/skill-language-server/actions/workflows/ci.yml/badge.svg)](https://github.com/CyrusNuevoDia/skill-language-server/actions/workflows/ci.yml)

Your skill library now has tooling.

▸ completion w/ descriptions on `/` and `$`\
▸ "did you mean" on typos\
▸ go to definition, find references\
▸ F2 rename w/ editor undo — folder, frontmatter `name:`, and every reference update as one edit\
▸ clickable links + semantic highlighting on resolved references

## Why

Skills, `CLAUDE.md`/`AGENTS.md`, and agent files reference each other by name — a dependency graph with all the refactoring hazards of code and none of the tooling. Rename a skill by hand and stale references look like ordinary prose: nothing errors, the agent silently stops loading the skill.

Quiet by design — a false reference in prose costs more than a missed one:

- Fenced code blocks are never parsed; inline code spans are (that's how people write skill names in prose)
- `/usr/bin`, `$PATH`, `docs/` — never references, never popups
- Near miss of a real skill (edit distance ≤ 2) → _did you mean_ warning; other unresolved `/name` → info hint; unresolved `$name` → silent
- Built-in commands (`/help`, `/compact`, …) and your own `.claude/commands`/`.codex/prompts` are commands, not skills — never flagged

It's a language server, not a linter — pair with `skill-lint` or `agnix` for structural/security linting.

## Install

[Cursor / Antigravity / VSCodium](#cursor--antigravity--vscodium) · [Zed](#zed) · [VS Code](#vs-code) · [Neovim](#neovim-011) · [Helix](#helix) · [from source](#from-source)

Once installed: cursor on any `/skill-name`, hit `F2`, type a new name — folder, frontmatter, and every reference update as one undo step.

### Cursor / Antigravity / VSCodium

[**Install the extension**](https://open-vsx.org/extension/cyrusnewday/skill-language-server) — or `cmd-shift-x` → search _Agent Skills Language Server_. Same for Windsurf and anything else pointed at Open VSX. The extension bundles the server; nothing else to install.

### Zed

[**Install the extension**](https://zed.dev/extensions/skill-language-server) — or `cmd-shift-x` → search _Skill Language Server_. It fetches the server itself; nothing else to install.

From a clone instead: command palette → `zed: install dev extension` → select `ext/zed/`. After server updates, `editor: restart language server`.

### VS Code

[**Install the extension**](https://marketplace.visualstudio.com/items?itemName=cyrusnewday.skill-language-server) — or `cmd-shift-x` → search _Agent Skills Language Server_. The extension bundles the server; nothing else to install.

### Neovim (0.11+)

1. Install the server:

   ```sh
   npm install -g skill-language-server
   ```

2. Create `~/.config/nvim/lsp/skill-language-server.lua`:

   ```lua
   return {
     cmd = { "skill-language-server", "--stdio" },
     filetypes = { "markdown" },
     root_markers = { ".claude", ".git" },
   }
   ```

3. Add `vim.lsp.enable("skill-language-server")` to init.lua.

(Or from a clone, skipping steps 1–2: `{ dir = "/path/to/skill-language-server/ext/nvim" }` in lazy.nvim.)

### Helix

1. Install the server:

   ```sh
   npm install -g skill-language-server
   ```

2. Add to `languages.toml`:

   ```toml
   [language-server.skill-language-server]
   command = "skill-language-server"
   args = ["--stdio"]

   [[language]]
   name = "markdown"
   language-servers = ["skill-language-server"]  # add e.g. "marksman" here if you use it
   ```

### From source

```sh
git clone https://github.com/CyrusNuevoDia/skill-language-server
cd skill-language-server
mise trust && mise install   # bun, just (rust only for the Zed wasm)
bun install
just bin                     # → ~/.local/bin/skill-language-server (Neovim, Helix, Zed)
```

For the VS Code–family editors, build and sideload the extension instead:

```sh
just build-vscode
code --install-extension dist/skill-language-server.vsix   # or cursor / codium / …
```

## How it scans

The server's world is the folder your editor opened — it never reads outside it. A rename touches exactly the tree you have open, never another checkout or your home directory. Open `~/.claude` itself as a workspace to refactor your global library.

- **Skills** = any `**/skills/<name>/SKILL.md`. Folder name is canonical; a disagreeing frontmatter `name:` is an error, not an alias
- **References** are scanned in `.md` files under `.claude/`, `.agents/`, `.codex/`, or `skills/`, plus every `CLAUDE.md`/`AGENTS.md`. Markdown elsewhere is never touched
- **Live index** where the editor supports LSP file watching; open buffers beat disk. Without watching, the index catches up on file open or restart
- **`.skillignore`** (gitignore syntax, workspace root) excludes paths from everything — `!` negation re-includes, with git's usual rule that you can't re-include inside an excluded directory (`dir/*` + `!dir/keep/` works; `dir/` + `!dir/keep/` doesn't)
- Multi-root workspaces: only the first folder is indexed

Cross-workspace renames are a deliberate two-step: rename where the skill lives, then open the other workspace — stale references surface as hints/warnings there. Blind spots: `$` stragglers stay silent, and an old name that doubles as a built-in command reads as the built-in.

## Client compatibility

Checked against client source as of 2026-07: VS Code, Zed, Helix, and Neovim all apply the folder `RenameFile`.

- Neovim never sends `willRenameFiles` — explorer-drag renames don't rewrite references there; rename from a token or the frontmatter instead
- File watching: VS Code and Zed yes; Neovim yes except off by default on Linux; Helix only sees its own edits — reopen the file or restart the server after external changes

## Development

```sh
just check   # tsc (server + VS Code extension) + ultracite lint + bun test
bun test     # just the protocol-level tests against a fixture workspace
just build   # everything into dist/ — binary, .vsix, Zed wasm (wasm needs rust)
just fmt     # ultracite fix --unsafe
```

The test suite is the contract: `tests/_harness.ts` boots the real server over in-memory streams; `tests/corpus.ts` is the ground-truth reference set. Done = `just check` green.

Three layers in `src/`: `parse.ts` (token grammar), `workspace.ts` (index), `server.ts` (LSP wiring). Editor shims in `ext/{vscode,zed,nvim}`.

Releases via [changesets](https://github.com/changesets/changesets): `bun changeset` with your change, merge to main, CI publishes.

## License

MIT
