# Logs

## `fetch/`: data fetch runs

Every run of `scripts/fetch.mjs <provider>` appends one line to a monthly file:

```
logs/fetch/2026/2026-09.jsonl
logs/fetch/2026/2026-10.jsonl
...
```

The hourly GitHub Actions run commits these files with the data. Runs on your own machine are logged too, with `"run": "local"`.

### Reading the log

```sh
node scripts/log-summary.mjs            # table of the last 7 days
npm run logs                            # last 30 days
```

Each GitHub Actions run also shows its own table on the run's summary page, followed by a **Source health** table (each provider's and source's status, last success and failures in a row, from `site/data/risk/health.json`). When a level moved, the run's line starts with "🔔 level changed: …" (from `levelChanged` or `levelChangesConfirmed`).

### Line format

```json
{
  "time": "2026-09-27T18:24:11.201Z",
  "source": "us",
  "run": "11223344.1",
  "trigger": "schedule",
  "result": "ok",
  "durationMs": 1830,
  "calls": {
    "api": { "url": "https://cadataapi.state.gov/api/TravelAdvisories",
             "attempts": [{ "status": 429, "ms": 812, "retryAfter": "60" }, { "status": 200, "ms": 1430 }] }
  },
  "stats": { "apiItems": 228, "duplicates": 11, "fromApi": 216, "advisories": 216,
             "keptFromPrevious": [], "droppedMissing": [], "levelChangesPending": 0, "levelChangesConfirmed": [] },
  "warnings": []
}
```

| Field | Meaning |
|---|---|
| `time` | When the run started (UTC) |
| `source` | The provider id, e.g. `us` or `ca` |
| `run` | GitHub Actions run id and attempt, or `local` |
| `trigger` | `schedule`, `workflow_dispatch`, or `local` |
| `result` | `ok` or `error`. On `error`, `error` holds the message and the previous data was kept. |
| `calls.<name>.attempts` | Each HTTP attempt: `status` and `ms`. `challenge: true` means Cloudflare served its bot check instead of the data. `retryAfter` is copied from the response header. `error` means a network failure or `timeout`. |
| `calls.feed`, `calls.table` | Canada's JSON feed and advisory table, listed per attempt |
| `calls.list` | The Netherlands' advisory list pages, counted rather than listed: `requests`, `statuses`, `errors`, `challenges`, `totalMs` |
| `calls.rss`, `calls.pages` | Runs before Sep 27, 2026 only: the U.S. RSS feed and Canada's destination pages, read for "what changed" notes, which are no longer used |
| `stats` | What the run produced (see below) |
| `warnings` | Problems that didn't stop the run, e.g. one Canada source unavailable, unconfirmed level changes |

The fields in `stats` depend on the source:

- **U.S.:**
  - `apiItems`: raw item count.
  - `duplicates`: items listed twice.
  - `fromApi`: unique advisories in this response.
  - `keptFromPrevious`: advisories missing from this response but kept from the previous snapshot.
  - `droppedMissing`: advisories removed after 7 days missing.
  - `levelChangesPending` and `levelChangesConfirmed`: level changes waiting for a later day's fetch, and the ones confirmed in this run.
  - `changeNotes` (runs before Sep 27, 2026): advisories with a "what changed" note.
- **Netherlands:**
  - `advisories`: number of advisories.
  - `levelRules`: how many levels each colour rule produced (`single`, `rest`, `country`, `severest`).
  - `severestFallback`: advisories whose level came from the most-severe-colour fallback. This should stay at a few; a jump means the Dutch wording changed.
  - `levelChangesPending` and `levelChangesConfirmed`, `keptFromPrevious`, `droppedMissing`, `staleIgnored`: as for the U.S.
- **Canada:**
  - `destinations`: number of destinations.
  - `sources`: which sources were used: `["feed", "table"]` normally, or just one if the other failed.
  - `feedGenerated`: when the JSON feed was last rebuilt (Eastern time).
  - `newerThanFeed`: destinations updated on the website after the feed was built. Their data came from the table.
  - `changed`: destinations whose timestamp changed since the previous run (shown as "updated").
  - `levelChanged`: destinations whose level changed since the previous run, e.g. `Mexico L2 → L3`. Canada's levels are official fields, so they apply at once, without the confirmation the U.S. and the Netherlands need.
  - `pagesRead` and `pagesFailed` (runs before Sep 27, 2026): destination pages read for "what changed" notes.
- **GDELT** (counts source, from Sep 28, 2026): `counted` (days counted in this run), `gaps` (older days without a file), `through` (the latest counted day), `events` (lines read), `unmapped` (the most frequent FIPS codes without a place, e.g. `OS` for oceans). `calls.daily` counts the zip downloads.
- **Germany** (from Sep 28, 2026): `destinations`, `changed` (destinations whose `lastModified` moved), `levelChanged` (applied at once). `calls.api` is the one list request.
- **UK** (from Sep 28, 2026): `destinations`, `changed` (pages re-read because they were republished), `levelChanged` (applied at once), `pagesFailed`. `calls.index` is listed per attempt; `calls.pages` is counted: all ~226 on the first run, then only republished pages.
- **GDACS** (risk source, from Sep 27, 2026):
  - `events`: events stored after this run (current ones, and ended ones for 90 days); `current`: how many GDACS still calls current.
  - `received`: Orange and Red events in this response (the last 30 days).
  - `added`: ids of events seen for the first time.
  - `alertChanged`: events whose alert level changed, e.g. `gdacs:TC:1001325 Orange → Red` (shown as "🔔 alert changed").
  - `closed`: stored "current" events older than the 30-day window, so GDACS can no longer list them; they are marked ended.
  - `archived`: ended events moved to `data/archive/events/`.

- **WHO** (risk source, from Sep 27, 2026): `events` (notices of the last 90 days), `received` (notices in this response, the latest 30), `added` (new notice ids), `archived`.

- **UCDP** (conflict source, from Oct 1, 2026): `fetched` (new monthly versions), `refetched` (stored versions downloaded again because the stored format changed, Oct 2, 2026), `skipped` (months that never came out), `through` (the latest version), `events` (events in the versions read), `unmapped` (country names missing from the config). `calls.version` counts the CSV downloads; a 404 means "not out yet".

- **USGS** and **EONET** (markers-only event sources, from Oct 2, 2026): `events` (stored: USGS's quakes of M5+ in 7 days, EONET's open volcanoes and those closed in the last 7 days), `current`, `received`, `added`, `archived`, as for GDACS. `calls.feed` and `calls.api` are the one request each.

- **Wikipedia** (context source, from Oct 2, 2026): `articles` (titles in the config), `fetched` (read in this run), `failed` (their last copy was kept), `noInfobox` (articles without a war infobox: their summary is still used). `calls.summary`, `calls.lead` and `calls.infobox` count the REST summaries, the lead sections and the infobox templates.

`calls.search` is GDACS's search endpoint, counted like `calls.list`. HTTP 204 means "no events".

## `data/sources-state.json`: last success of every fetch

Next to the log, `scripts/fetch.mjs` keeps one entry per provider and source: `lastAttempt`, `lastSuccess`, `durationMs`, `records`, `consecutiveFailures` and the last `error`. The hourly workflow's due check reads it, and the build publishes it as `site/data/risk/health.json` with a status (`healthy`, `delayed`, `error`).
