---
name: ship
description: Ship skill-language-server — a sonnet subagent builds, installs, verifies, changesets, pushes, and watches the release; failures come back to the main thread to fix.
---

# Ship

Delegate the whole pipeline to a subagent (Agent tool, `model: "sonnet"`, run in
background). Never run these steps on the main thread, and never fix failures in
the subagent — it reports back and the fix happens here in the main thread.

The subagent's prompt must be self-contained and include this pipeline verbatim:

1. **Build + install locally**
   - `mise exec -- just build` (binary, npm bundle, .vsix, Zed wasm)
   - `mise exec -- just bin`
   - `code --install-extension dist/skill-language-server.vsix`
2. **Verify it works**
   - `mise exec -- just check` — all green (includes the full test suite)
   - stdio smoke test: pipe an LSP `initialize` request (Content-Length framed)
     into `~/.local/bin/skill-language-server --stdio`, keeping stdin open ~2s,
     and confirm a `capabilities` response comes back
3. **On any failure above**: STOP. SendMessage to "main" with the failing
   command and the output tail. No changeset, no commit, no push.
4. **If green, mint a changeset**: write a file in `.changeset/` directly
   (frontmatter `"skill-language-server": patch|minor` judged from the pending
   diff, one-line summary). Never run interactive `bun changeset`.
5. **Commit** the pending work in logical, file-scoped commits — stage explicit
   paths, never `git add -A` blindly, and don't sweep up unrelated WIP. Use the
   commit trailers found in this repo's recent history.
6. `git pull --rebase` then `git push`.
7. **Watch the release**: `gh run list --workflow=release --event=push --limit 1`
   then `gh run watch <id> --exit-status`. On green, `git pull` (CI commits the
   version bump) and poll `npm view skill-language-server version` until it
   matches package.json.
8. **Report back to "main"** either way: published version + run URL on
   success, or the failing job + log tail (`gh run view <id> --log-failed`) on
   failure — the main thread fixes and re-ships.

Notes for the subagent:
- Publishing is npm OIDC trusted publishing via GitHub Actions — there are no
  tokens and no `npm login`; auth errors in CI are a report-back, not something
  to work around.
- Zed picks up a new binary on `editor: restart language server`; the dev
  extension itself only needs reinstalling when `ext/zed/` changes.
- A push that touches no release inputs (e.g. only `.claude/`) skips the
  release job entirely — that's a success, not a failure.
