# Audience

Who this project serves, in priority order, and who it deliberately doesn't.
This is a decision filter: when weighing a feature, a default, a line of README
copy, or a support burden, test it against the primary reader below. If it
doesn't help them, it needs a reason from the secondary list — or it's out.

## Primary: the agent power-user

An individual who runs a coding agent (Claude Code, Codex, or similar) daily
and has accumulated a real skill library: a global `~/.claude/skills`,
per-repo `skills/` directories, and `CLAUDE.md`/`AGENTS.md` memory files that
reference them. Dozens of skills, several workspaces, references crossing all
of them.

Their pain is silent breakage. Skills reference each other by name, and
nothing enforces those names: rename a skill by hand and every stale `/ship`
or `$verify` keeps looking like prose. No error, no warning — the agent just
never loads the skill, and they find out mid-session. They already live in a
real editor (VS Code, Zed, Neovim, Helix) and expect the ergonomics
TypeScript gives symbols: rename with confidence, jump to definition, see
every reference, get told about typos.

They have zero patience for configuration. Install once, open markdown,
it works. Every knob is a cost.

**The test:** does this help someone with 30+ skills across five repos
refactor without fear?

## Secondary: served, not optimized for

These groups get value from exactly what the primary audience needs — we name
them so their needs can justify a decision, not so they can steer the roadmap.

- **Team skill libraries.** Skills checked into shared repos, where a rename
  breaks other people's sessions, not just your own. Raises the stakes on
  rename correctness; doesn't by itself justify team features (CI modes,
  reports, enforcement).
- **Skill-pack authors.** People publishing reusable skill collections who
  want cross-references verified before shipping. Diagnostics are their
  feature; they get them because the power-user needed them first.
- **Agent-tool builders.** Harness and CLI authors who might embed or
  recommend the server. They're why protocol behavior stays clean and
  distribution stays boring: npm binary, bundled VS Code extension, no
  bespoke setup.

## Not for

- **The two-skill user.** Hand-renaming two files is fine. We don't add
  onboarding, tutorials, or discovery features to chase people who don't
  feel the pain yet.
- **People who want a linter.** Structure, style, and security linting of
  skill content is `skill-lint`/`agnix` territory. Our diagnostics stay
  scoped to reference integrity — names that don't resolve, frontmatter that
  disagrees, duplicates. We don't grow lint rules.
- **Editor-less workflows.** Someone who only touches skills through a web
  agent or chat UI has no LSP client; the editor is our surface. We don't
  build standalone rename/check CLIs for them.
- **General markdown users.** The scope rule exists so a rename can never
  rewrite a blog post. Any feature that risks noise in ordinary markdown —
  popups, diagnostics, links outside skill scopes — fails the filter no
  matter how useful it'd be inside them.

## What this implies

- **Breadth before depth:** a feature ships when it works in all four
  editors; editor-specific polish comes after, if ever.
- **Quiet by default:** a false positive in prose costs more than a missed
  reference. When the grammar is ambiguous, stay silent.
- **Convention over configuration:** folder name is the skill name, the
  scope rule is fixed, `.skillignore` is the single escape hatch.
