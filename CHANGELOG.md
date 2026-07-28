# skill-language-server

## 0.5.2

### Patch Changes

- [`4eeefb6`](https://github.com/CyrusNuevoDia/skill-language-server/commit/4eeefb60875d92ebe9a4ece2924fac8e289622c0) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Publish the editor extension to Open VSX — installable from Extensions in Cursor, Antigravity, VSCodium, and Windsurf. The extension manifest now carries an icon, a marketplace README, and the root package's version.

## 0.5.1

### Patch Changes

- [`3a8a6f6`](https://github.com/CyrusNuevoDia/skill-language-server/commit/3a8a6f689176bfa9f0c94bcf8809aa2905473f0d) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Relax Node engines requirement to >=22 so the Zed extension can run the npm-installed server on Zed's bundled Node runtime. The Zed shim now auto-installs `skill-language-server` from npm (and keeps it updated) when no binary is found on PATH.

## 0.5.0

### Minor Changes

- [`3473967`](https://github.com/CyrusNuevoDia/skill-language-server/commit/34739678a1d3bdd6ab728c4477e53b0d64da135e) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Unresolved `/references` now get an info-level "Unknown skill" diagnostic, closing the silent-stale-reference gap for renames that travel beyond did-you-mean's edit distance. Built-in CLI commands (Claude Code + Codex CLI, curated in `src/builtins.ts`) and workspace-defined custom commands (`.claude/commands/*.md`, `.codex/prompts/*.md`) are recognized as commands, not skills, and are exempt from all unknown-skill diagnostics — including did-you-mean warnings, so a skill named `modal` no longer flags prose mentions of `/model`. `$`-sigil tokens are unaffected: they still get near-miss warnings but never the info hint, since ordinary prose (`$5`, `$my_var`) matches the token grammar.

## 0.4.2

### Patch Changes

- [`220544a`](https://github.com/CyrusNuevoDia/skill-language-server/commit/220544a242270f2339491822ee5942283cf96b9a) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Internal refactors: arktype/arkregex validation and shared utils extraction

## 0.4.1

### Patch Changes

- [`7f8d8c9`](https://github.com/CyrusNuevoDia/skill-language-server/commit/7f8d8c9374d97a6fefca0f930c10bd076f0c40a5) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Separator runs are valid inside skill names (`a::b`, `x--y`); separators still can't lead or trail.

## 0.4.0

### Minor Changes

- [`0ae18d0`](https://github.com/CyrusNuevoDia/skill-language-server/commit/0ae18d049a1090f0287e26ef818ef4555b32c1f5) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Skill names now support `_` and plugin-style `:` separators (e.g. `/data_sync`, `/report:weekly`). Separators can't lead, trail, or double, so a trailing colon in prose ("use /ship: then…") stays prose.

## 0.3.0

### Minor Changes

- [`84927d9`](https://github.com/CyrusNuevoDia/skill-language-server/commit/84927d9de6ffd7812c70fadf3386835dd1a412c6) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Rename the binary and all identifiers from `skill-lsp` to `skill-language-server`, require Node >= 24, move all package scripts into the justfile, and run CI through mise + just.

## 0.2.0

### Minor Changes

- [`4a9ddd8`](https://github.com/CyrusNuevoDia/skill-language-server/commit/4a9ddd8fbbb17c47634c0bfe2f43820a9f23fd69) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Initial release: LSP for SKILL.md — definition, references, cross-file rename, diagnostics, completion, semantic tokens, document links.
