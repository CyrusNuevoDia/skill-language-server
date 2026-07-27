# skill-language-server

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
