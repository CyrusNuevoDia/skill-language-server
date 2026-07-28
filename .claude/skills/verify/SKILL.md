---
name: verify
description: Run this repo's full verification — typecheck, lint, and the protocol-level LSP test suite.
---

# Verify

Run, from the repo root:

```bash
just check
```

It runs four things:
- `tsc --noEmit` on the root server (`src/`)
- `tsc --noEmit -p ext/vscode` for the VS Code extension
- `ultracite check` for linting
- `bun test` — the protocol-level LSP tests in `tests/`: definition,
  references, rename, will-rename, watched files, diagnostics, completion,
  semantic tokens, document links, name grammar, `.skillignore`, and stdio
  transport — driving the server over real LSP requests/responses.

A failure in any of these means the work is not done. Fix the root cause and
re-run `just check` until everything is green — never skip a failing check or
ship past it.

Once green, use /ship to build, install, release, and watch CI via a subagent.
