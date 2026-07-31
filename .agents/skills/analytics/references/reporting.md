# Reporting contract

Treat the collector's JSON as the data boundary. Generate all tables, charts, and narrative in Codex's response; do not add presentation formats to the collector.

## Metric meanings

| Field | Meaning |
| --- | --- |
| Lifetime downloads | Current cumulative counter published by that channel |
| Last 7 days | Source-provided rolling count when available; otherwise sum of the last seven complete daily points |
| Window downloads | Sum of returned daily points inside the requested trailing window |
| Data through | Last date represented by a daily series |

Use an em dash for metrics a source does not publish. Do not convert missing data to zero.

## Output order

1. Show a compact table first.
2. Show separate daily charts for npm and Open VSX.
3. Give two to four takeaways, emphasizing direction and source freshness.
4. End with the non-deduplication caveat when the audience could mistake downloads for users.

Do not create a cross-channel grand total. Do not call a download an install, user, active user, retained user, or market-share point without independent evidence.

When comparing periods, compare equal-length complete windows. Do not compare npm's last complete UTC day with an incomplete current-day Open VSX bucket without saying so.
