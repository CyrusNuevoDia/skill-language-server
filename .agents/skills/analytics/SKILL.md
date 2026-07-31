---
name: analytics
description: Collect and explain public download and usage signals for Skill Language Server across npm, Open VSX, Zed, and future distribution channels. Use when asked for $analytics, an analytics pulse, extension adoption, package downloads, install trends, channel comparisons, or charts and tables about product usage.
---

# Analytics

Produce a current, source-backed distribution pulse without presenting downloads as unique users.

## Run the collector

From the repository root, run:

```bash
node .agents/skills/analytics/scripts/fetch-analytics.mjs
```

Use `--days N` to change the trailing window (default: 30). Run `--help` for the complete interface. The collector always emits JSON; interpret that data yourself instead of asking the script to generate prose or presentation.

The collector queries all sources concurrently and reports a failed source explicitly while preserving successful results. Treat a partial result as partial; never claim every channel was checked when one failed.

## Present the pulse

1. Read the collector's JSON and lead with a compact Markdown table.
2. Keep the npm and Open VSX charts separate because their download events have different meanings.
3. Add two to four concise takeaways grounded in the returned values.
4. State the data-through date for lagging daily sources.
5. Link each source page in the final answer.
6. Keep the caveat that downloads are events or proxies, not people.

Do not sum npm, Open VSX, and Zed counts into “total users.” Zed installs can trigger npm downloads, retries and CI can inflate npm, and marketplace downloads are not identity-deduplicated.

Read [references/sources.md](references/sources.md) when a source breaks or when adding a channel. Read [references/reporting.md](references/reporting.md) before changing metric definitions or presentation rules.

## Verify before reporting

- Confirm `generatedAt` is from the current run.
- Confirm every requested channel is either `ok` or visibly listed as unavailable.
- Use the source-provided lifetime count when available; do not reconstruct it from a short trend window.
- Describe the current UTC day as partial when a source includes it. npm intentionally ends at the last complete UTC day.
- Never infer active users, retention, or editor market share from these public counters.
