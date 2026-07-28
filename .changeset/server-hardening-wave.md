---
"skill-language-server": minor
---

Symlinked skill folders now resolve (dotfile-managed setups work; the index keeps symlink-side paths), completion accepting a multi-segment name no longer mangles the typed prefix (items carry an explicit textEdit), and rename from a duplicate skill's frontmatter renames that skill's own folder instead of the first-indexed twin. Diagnostics are only published when non-empty (plus one clearing publish when a file goes clean), so Neovim stops accumulating phantom buffers. Parser fixes: CommonMark fence pairing (a `~~~` line inside a ``` block no longer ends it), `~/paths` are never skill references, frontmatter delimiters must sit at column 0, one wrong-typed frontmatter field no longer erases the others, and a YAML comment after `name:` survives rename. Closing a dirty buffer without saving reverts to disk truth; deleting a skill folder evicts everything under it. All filesystem I/O is now async behind an ordering-preserving queue.
