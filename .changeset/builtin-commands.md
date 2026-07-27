---
"skill-language-server": minor
---

Unresolved `/references` now get an info-level "Unknown skill" diagnostic, closing the silent-stale-reference gap for renames that travel beyond did-you-mean's edit distance. Built-in CLI commands (Claude Code + Codex CLI, curated in `src/builtins.ts`) and workspace-defined custom commands (`.claude/commands/*.md`, `.codex/prompts/*.md`) are recognized as commands, not skills, and are exempt from all unknown-skill diagnostics — including did-you-mean warnings, so a skill named `modal` no longer flags prose mentions of `/model`. `$`-sigil tokens are unaffected: they still get near-miss warnings but never the info hint, since ordinary prose (`$5`, `$my_var`) matches the token grammar.
