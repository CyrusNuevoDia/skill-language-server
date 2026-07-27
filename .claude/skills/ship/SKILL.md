---
name: ship
description: Rebuild and install all skill-lsp distribution artifacts (server binary, VS Code extension, Zed wasm).
---

# Ship

Always run /verify before shipping — don't rebuild on top of a red check.

From the repo root:

```bash
just build
just bin
code --install-extension dist/skill-lsp.vsix
```

- `just build` produces `dist/skill-lsp` (server binary), `dist/skill-lsp.vsix` (VS Code extension), and `dist/zed_skill_lsp.wasm` (Zed extension).
- `just bin` installs the server binary to `~/.local/bin` — this is what Zed's language server actually runs.
- The `code --install-extension` step installs the packaged VS Code extension.

Zed doesn't need a reinstall step for the binary: it picks up the new one on the next restart of the language server. The Zed extension itself (`ext/zed`) is installed once via "zed: install dev extension" and doesn't need reinstalling on every ship — only the binary changes.
