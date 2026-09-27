# Logs

## `fetch/`: data fetch runs

Every run of `scripts/fetch.mjs <provider>` appends one line to a monthly file:

```
logs/fetch/2026/2026-09.jsonl
logs/fetch/2026/2026-10.jsonl
...
```

The daily GitHub Actions run commits these files with the data. Runs on your own machine are logged too, with `"run": "local"`.

### Reading the log

```sh
node scripts/log-summary.mjs            # table of the last 7 days
npm run logs                            # last 30 days
```

Each GitHub Actions run also shows its own table on the run's summary page.

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
