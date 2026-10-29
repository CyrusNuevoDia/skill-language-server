# Agent Skills Language Server

Rename agent skills without leaving stale references — in VS Code, Cursor, Windsurf, Antigravity, and VSCodium. Works with Claude Code, Codex, and other agents that use `SKILL.md`. The server is bundled; nothing else to install.

## Try a rename

Open a folder containing your skill library, then press `F2` on `/ship` or `$ship` and enter `release`:

| Before | After |
| --- | --- |
| `skills/ship/SKILL.md` | `skills/release/SKILL.md` |
| `name: ship` | `name: release` |
| `Run /ship after $review.` | `Run /release after $review.` |
| `[Ship](skills/ship/SKILL.md)` | `[Ship](skills/release/SKILL.md)` |

The changes apply together and undo together. Use `F12` on a reference to jump to its skill, or **Find All References** to see where it's used. For a global library, open `~/.claude`, `~/.agents`, or `~/.codex` as the workspace.

Completion includes skill descriptions and client-aware frontmatter fields. You also get hover, typo suggestions, semantic highlighting, and diagnostics for invalid frontmatter, unbalanced XML, and broken local Markdown links.

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
