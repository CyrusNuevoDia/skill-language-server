# Data sources

## Open VSX

- Human page: `https://vsx-pulse.org/Extension/cyrusnewday.skill-language-server`
- Daily series: `https://vsx-pulse.org/api/series?grain=day&metric=downloads&id=cyrusnewday.skill-language-server`
- Read the lifetime total, rolling 7-day gain, and version from the human page. Read daily deltas from the JSON endpoint.
- The daily endpoint can include the current, incomplete UTC day. Preserve and label that fact.

VSX Pulse is a third-party observer of the Open VSX registry. If its API changes, inspect the human page and its loaded JavaScript before updating the parser. Do not silently substitute VS Code Marketplace counts.

## npm

- Human chart: `https://www.npmcharts.com/compare/skill-language-server?interval=1`
- Registry metadata: `https://registry.npmjs.org/skill-language-server`
- Daily range: `https://api.npmjs.org/downloads/range/{start}:{end}/skill-language-server`
- Lifetime point: `https://api.npmjs.org/downloads/point/{created}:{end}/skill-language-server`

npmcharts calls the official npm downloads range API and falls back to its own proxy. Query the official API directly. End at yesterday in UTC so a partial current day does not look like a collapse.

The npm counter includes package fetches from CI, retries, local installs, and editor-managed installation. It is not a unique-install counter.

## Zed

- Human page: `https://zed.dev/extensions/skill-language-server`

Zed server-renders `Version`, `Downloads`, and `Last updated` into the extension page. No public daily-series endpoint is exposed by this page. Parse only those labelled values and fail visibly if they disappear; do not scrape arbitrary number positions.

Zed's extension shim can install the npm package, so Zed and npm counts overlap.
