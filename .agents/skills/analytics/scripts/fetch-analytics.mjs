#!/usr/bin/env node

const DEFAULT_DAYS = 30;
const REQUEST_TIMEOUT_MS = 15_000;

const SOURCES = Object.freeze({
  npm: {
    pageURL: "https://www.npmcharts.com/compare/skill-language-server?interval=1",
    packageName: "skill-language-server",
  },
  openVSX: {
    extensionId: "cyrusnewday.skill-language-server",
    pageURL:
      "https://vsx-pulse.org/Extension/cyrusnewday.skill-language-server",
  },
  zed: {
    pageURL: "https://zed.dev/extensions/skill-language-server",
  },
});

function usage() {
  return `Usage: node fetch-analytics.mjs [options]

Options:
  --days N                Trailing daily window (1-365, default: ${DEFAULT_DAYS})
  --help                  Show this help

The command always prints JSON. It preserves successful sources if another
source is unavailable; inspect the errors array before reporting completion.`;
}

function parseArguments(arguments_) {
  const options = { days: DEFAULT_DAYS };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "--days") {
      options.days = Number(arguments_[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 365) {
    throw new Error("--days must be an integer from 1 through 365");
  }
  return options;
}

function toUTCDate(date) {
  return date.toISOString().slice(0, 10);
}

function addUTCDays(date, delta) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

function sum(points) {
  return points.reduce((total, point) => total + point.value, 0);
}

function last(points, count) {
  return points.slice(-count);
}

function parseCount(value, label) {
  const count = Number(String(value).replaceAll(",", "").trim());
  if (!Number.isFinite(count)) {
    throw new Error(`Could not parse ${label}`);
  }
  return count;
}

async function fetchResponse(url, accept) {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "skill-language-server-analytics/1",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  return response;
}

async function fetchJSON(url) {
  return (await fetchResponse(url, "application/json")).json();
}

async function fetchText(url) {
  return (await fetchResponse(url, "text/html")).text();
}

function textAfterCardLabel(html, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(
      `<span>${escapedLabel}<\\/span><\\/div>\\s*<div class="card-value"[^>]*>([\\s\\S]*?)<\\/div>`,
      "i"
    )
  );
  if (!match) {
    throw new Error(`VSX Pulse page no longer exposes ${label}`);
  }
  return match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function collectOpenVSX(startDate) {
  const { extensionId, pageURL } = SOURCES.openVSX;
  const seriesURL = new URL("/api/series", pageURL);
  seriesURL.search = new URLSearchParams({
    grain: "day",
    metric: "downloads",
    id: extensionId,
  });

  const [html, rawSeries] = await Promise.all([
    fetchText(pageURL),
    fetchJSON(seriesURL),
  ]);
  if (!Array.isArray(rawSeries)) {
    throw new Error("VSX Pulse series response is not an array");
  }

  const series = rawSeries
    .map((point) => ({ date: point.bucket, value: Number(point.delta) }))
    .filter(
      (point) =>
        /^\d{4}-\d{2}-\d{2}$/.test(point.date) &&
        Number.isFinite(point.value) &&
        point.date >= startDate
    );

  return {
    status: "ok",
    label: "Open VSX",
    pageURL,
    dataURL: seriesURL.toString(),
    lifetimeDownloads: parseCount(
      textAfterCardLabel(html, "Total downloads"),
      "Open VSX lifetime downloads"
    ),
    last7Days: parseCount(
      textAfterCardLabel(html, "7d gain"),
      "Open VSX 7-day gain"
    ),
    windowDownloads: sum(series),
    latestVersion: textAfterCardLabel(html, "Version"),
    dataThrough: series.at(-1)?.date ?? null,
    includesPartialCurrentDay: series.at(-1)?.date === toUTCDate(new Date()),
    series,
    note: "Marketplace download events reported by VSX Pulse.",
  };
}

async function collectNPM(startDate, completeThrough) {
  const { packageName, pageURL } = SOURCES.npm;
  const encodedPackage = encodeURIComponent(packageName);
  const registryURL = `https://registry.npmjs.org/${encodedPackage}`;
  const rangeURL = `https://api.npmjs.org/downloads/range/${startDate}:${completeThrough}/${encodedPackage}`;

  const [metadata, range] = await Promise.all([
    fetchJSON(registryURL),
    fetchJSON(rangeURL),
  ]);
  const createdAt = metadata?.time?.created;
  if (typeof createdAt !== "string") {
    throw new Error("npm registry metadata is missing time.created");
  }

  const lifetimeStart = createdAt.slice(0, 10);
  const lifetimeURL = `https://api.npmjs.org/downloads/point/${lifetimeStart}:${completeThrough}/${encodedPackage}`;
  const lifetime = await fetchJSON(lifetimeURL);
  if (!Array.isArray(range?.downloads)) {
    throw new Error("npm range response is missing downloads");
  }

  const series = range.downloads.map((point) => ({
    date: point.day,
    value: Number(point.downloads),
  }));

  return {
    status: "ok",
    label: "npm",
    pageURL,
    dataURL: rangeURL,
    lifetimeDownloads: parseCount(lifetime.downloads, "npm lifetime downloads"),
    last7Days: sum(last(series, 7)),
    windowDownloads: sum(series),
    latestVersion: metadata?.["dist-tags"]?.latest ?? null,
    firstPublishedAt: createdAt,
    dataThrough: range.end ?? completeThrough,
    includesPartialCurrentDay: false,
    series,
    note: "Package download events; CI, retries, and editor-managed installs can inflate counts.",
  };
}

function matchZedValue(html, pattern, label) {
  const match = html.match(pattern);
  if (!match) {
    throw new Error(`Zed page no longer exposes ${label}`);
  }
  return match[1];
}

async function collectZed() {
  const { pageURL } = SOURCES.zed;
  const html = await fetchText(pageURL);
  const downloads = matchZedValue(
    html,
    /Downloads:(?:<!--.*?-->)?\s*([\d,]+)/i,
    "downloads"
  );
  const version = matchZedValue(
    html,
    /Version:(?:<!--.*?-->)?\s*([^<"\\]+)/i,
    "version"
  ).trim();
  const lastUpdated = matchZedValue(
    html,
    /Last updated on (?:<!--.*?-->)?([^<"\\]+)/i,
    "last-updated date"
  ).trim();

  return {
    status: "ok",
    label: "Zed",
    pageURL,
    dataURL: pageURL,
    lifetimeDownloads: parseCount(downloads, "Zed lifetime downloads"),
    last7Days: null,
    windowDownloads: null,
    latestVersion: version,
    lastUpdated,
    dataThrough: null,
    includesPartialCurrentDay: false,
    series: [],
    note: "Cumulative extension downloads; Zed does not expose a public daily series here.",
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const now = new Date();
  const currentUTCDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const lastCompleteUTCDate = addUTCDays(currentUTCDate, -1);
  const liveStart = toUTCDate(addUTCDays(currentUTCDate, 1 - options.days));
  const completeStart = toUTCDate(
    addUTCDays(lastCompleteUTCDate, 1 - options.days)
  );
  const completeThrough = toUTCDate(lastCompleteUTCDate);
  const collectors = {
    npm: () => collectNPM(completeStart, completeThrough),
    openVSX: () => collectOpenVSX(liveStart),
    zed: () => collectZed(),
  };
  const entries = await Promise.all(
    Object.entries(collectors).map(async ([sourceName, collect]) => {
      try {
        return [sourceName, await collect(), null];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [sourceName, { status: "error", message }, { source: sourceName, message }];
      }
    })
  );
  const report = {
    generatedAt: now.toISOString(),
    window: {
      days: options.days,
      liveStart,
      completeStart,
      completeThrough,
    },
    sources: Object.fromEntries(entries.map(([name, source]) => [name, source])),
    errors: entries.flatMap(([, , error]) => (error ? [error] : [])),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (report.errors.length === entries.length) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(usage());
  process.exitCode = 1;
}
