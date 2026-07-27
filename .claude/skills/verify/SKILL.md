---
name: verify
description: Run this repo's full verification — typecheck, lint, and the protocol-level LSP test suite.
---

# Verify

Run, in order, from the repo root:

```bash
just check
bun test
```

`just check` runs three things:
- `tsc --noEmit` on the root server (`src/`)
- `tsc --noEmit -p ext/vscode` for the VS Code extension
- `ultracite check` for linting

`bun test` runs the 26 protocol-level LSP tests in `tests/` — definition, references, rename, will-rename, diagnostics, completion, and stdio transport — driving the server over real LSP requests/responses.

A failure in any of these means the work is not done. Fix the root cause and re-run both commands until everything is green — never skip a failing check or ship past it.

Once green, use /ship to rebuild and install all editor artifacts.
