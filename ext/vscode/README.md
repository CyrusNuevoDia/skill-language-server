# Agent Skills Language Server

`/skill-name` and `$skill-name` become real symbols — in Cursor, Antigravity, VSCodium, Windsurf, and VS Code.

▸ completion w/ descriptions on `/` and `$`\
▸ "did you mean" on typos\
▸ go to definition, find references\
▸ F2 rename w/ editor undo — folder, frontmatter `name:`, and every reference update as one edit\
▸ clickable links + semantic highlighting on resolved references

Your skill library now has tooling. Nothing else to install — the server is bundled.

## Why

Skills, `CLAUDE.md`/`AGENTS.md`, and agent files reference each other by name — a dependency graph with all the refactoring hazards of code and none of the tooling. Rename a skill by hand and stale references look like ordinary prose: nothing errors, the agent silently stops loading the skill.

Quiet by design — a false reference in prose costs more than a missed one:

- Fenced code blocks are never parsed; inline code spans are (that's how people write skill names in prose)
- `/usr/bin`, `$PATH`, `docs/` — never references, never popups
- Near miss of a real skill (edit distance ≤ 2) → _did you mean_ warning; other unresolved `/name` → info hint; unresolved `$name` → silent
- Built-in commands (`/help`, `/compact`, …) and your own `.claude/commands`/`.codex/prompts` are commands, not skills — never flagged

It's a language server, not a linter — pair with `skill-lint` or `agnix` for structural/security linting.

## How it scans

The server's world is the folder your editor opened — it never reads outside it. A rename touches exactly the tree you have open, never another checkout or your home directory. Open `~/.claude` itself as a workspace to refactor your global library.

- **Skills** = any `**/skills/<name>/SKILL.md`. Folder name is canonical; a disagreeing frontmatter `name:` is an error, not an alias
- **References** are scanned in `.md` files under `.claude/`, `.agents/`, `.codex/`, or `skills/`, plus every `CLAUDE.md`/`AGENTS.md`. Markdown elsewhere is never touched
- **`.skillignore`** (gitignore syntax, workspace root) excludes paths from everything
- Multi-root workspaces: only the first folder is indexed

## Other editors

The same server runs in [Zed](https://zed.dev/extensions/skill-language-server), Neovim 0.11+, and Helix — setup for each is in the [repository](https://github.com/CyrusNuevoDia/skill-language-server#install).

## License

MIT
