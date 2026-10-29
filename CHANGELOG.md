# skill-language-server

## 0.8.1

### Patch Changes

- [`72389a2`](https://github.com/CyrusNuevoDia/skill-language-server/commit/72389a2a2ec70b7c6ad8fc36802fa67d953d9586) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Show the complete skill rename in the install pages, add global-library first-use instructions, and include Codex in package search keywords.

- [`e3e2b0a`](https://github.com/CyrusNuevoDia/skill-language-server/commit/e3e2b0a8edee816c90b9b7bc9061c31223f0b458) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Scan directory entries in name order so duplicate skill references consistently resolve to the first-indexed definition across filesystems and operating systems.

- [`ce9df36`](https://github.com/CyrusNuevoDia/skill-language-server/commit/ce9df36f97e098d8268baa3d2d2cbc780dde2c11) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Keep references in scope when opening a global agent directory or a skill folder as the workspace. Index skills named build, dist, and node_modules while continuing to skip ordinary artifact directories.

- [`e012a4c`](https://github.com/CyrusNuevoDia/skill-language-server/commit/e012a4ca26692b18ad170dbe1abbb45d7652cbf0) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Discover a skill and its Markdown references when an editor reports only a folder-created event after moving or installing it. Preserve unsaved buffers and workspace ignore rules during the refresh.

- [`a06b7e8`](https://github.com/CyrusNuevoDia/skill-language-server/commit/a06b7e87351da6d6879f70576ff26be74051130b) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Keep Zed's installed server available when the npm version check fails, including while offline. A first installation still reports the registry error when no cached server exists.

## 0.8.0

### Minor Changes

- [`74c402c`](https://github.com/CyrusNuevoDia/skill-language-server/commit/74c402c89e4a63abe2458a03aaf3b95c771c1ca1) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Expand skill authoring support across validation, navigation, and completion:

  - Add client-aware frontmatter field and finite-value completion backed by a shared schema catalog.
  - Diagnose malformed frontmatter, invalid field types, duplicate keys, invalid skill names, and unbalanced XML-shaped markup with precise source ranges.
  - Resolve local Markdown destinations for definitions, references, hover, rename, diagnostics, and safe broken-link quick fixes.
  - Add hover details for skill declarations and references, including canonical names, descriptions, and workspace-relative paths.

## 0.7.0

### Minor Changes

- [`b4df6d2`](https://github.com/CyrusNuevoDia/skill-language-server/commit/b4df6d2505c0c9b1d0d8ad00923fcd70873116f4) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Parser correctness fixes and unrestricted name length, locked in by a new fast-check property suite:

  - CRLF documents now close code fences correctly. Previously a fence opener in a `\r\n` file never matched its closer, silencing tokens, diagnostics, and completion for the rest of the document.
  - The frontmatter `name:` range now anchors strictly after the key, so a skill named `name` (or any short value occurring inside the literal text `name:`) renames its value, never the key.
  - Skill names are no longer capped at 64 characters — anything the token grammar accepts is a valid rename target.

## 0.6.0

### Minor Changes

- [`eb74002`](https://github.com/CyrusNuevoDia/skill-language-server/commit/eb7400280678a0f7db8af87fd6e4c557f643c060) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Symlinked skill folders now resolve (dotfile-managed setups work; the index keeps symlink-side paths), completion accepting a multi-segment name no longer mangles the typed prefix (items carry an explicit textEdit), and rename from a duplicate skill's frontmatter renames that skill's own folder instead of the first-indexed twin. Diagnostics are only published when non-empty (plus one clearing publish when a file goes clean), so Neovim stops accumulating phantom buffers. Parser fixes: CommonMark fence pairing (a `~~~` line inside a ```block no longer ends it),`~/paths`are never skill references, frontmatter delimiters must sit at column 0, one wrong-typed frontmatter field no longer erases the others, and a YAML comment after`name:` survives rename. Closing a dirty buffer without saving reverts to disk truth; deleting a skill folder evicts everything under it. All filesystem I/O is now async behind an ordering-preserving queue. Frontmatter delimiter and YAML semantics now match gray-matter — the node-ecosystem standard for frontmatter, and how skill loaders actually parse these files.

### Patch Changes

- [`7209e13`](https://github.com/CyrusNuevoDia/skill-language-server/commit/7209e13c383df4c6bbe284ddbbefa7536a29bb55) Thanks [@CyrusNuevoDia](https://github.com/CyrusNuevoDia)! - Publish the editor extension to the VS Code Marketplace, alongside Open VSX. The extension's display name becomes "Agent Skills Language Server" (the Marketplace rejects "Skill Language Server" as too similar to "SQL Language Server"), and the manifest gains a Marketplace-facing README and one-click install badge.

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
