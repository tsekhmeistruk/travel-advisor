# Logs

## `fetch/`: data fetch runs

Every run of `scripts/fetch-us.mjs` or `scripts/fetch-canada.mjs` appends one line to a monthly file:

```
logs/fetch/2026/2026-09.jsonl
logs/fetch/2026/2026-10.jsonl
...
```

The daily GitHub Actions run commits these files with the data. Runs on your own machine are logged too, with `"run": "local"`.

### Reading the log

```sh
node scripts/log-summary.mjs            # table of the last 7 days
node scripts/log-summary.mjs --days 30  # last 30 days
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
             "attempts": [{ "status": 429, "ms": 812, "retryAfter": "60" }, { "status": 200, "ms": 1430 }] },
    "rss": { "url": "https://travel.state.gov/_res/rss/TAsTWs.xml", "attempts": [{ "status": 200, "ms": 402 }] }
  },
  "stats": { "apiItems": 228, "duplicates": 11, "fromApi": 216, "advisories": 216,
             "keptFromPrevious": [], "droppedMissing": [], "changeNotes": 153 },
  "warnings": []
}
```

| Field | Meaning |
|---|---|
| `time` | When the run started (UTC) |
| `source` | `us` or `ca` |
| `run` | GitHub Actions run id and attempt, or `local` |
| `trigger` | `schedule`, `workflow_dispatch`, or `local` |
| `result` | `ok` or `error`. On `error`, `error` holds the message and the previous data was kept. |
| `calls.<name>.attempts` | Each HTTP attempt: `status` and `ms`. `challenge: true` means Cloudflare served its bot check instead of the data. `retryAfter` is copied from the response header. `error` means a network failure or `timeout`. |
| `calls.pages` | Canada's destination pages, counted rather than listed: `requests`, `statuses`, `errors`, `challenges`, `totalMs` |
| `stats` | What the run produced (see below) |
| `warnings` | Problems that didn't stop the run, e.g. RSS unavailable, pages that couldn't be read |

The fields in `stats` depend on the source:

- **U.S.:**
  - `apiItems`: raw item count.
  - `duplicates`: items listed twice.
  - `fromApi`: unique advisories in this response.
  - `keptFromPrevious`: advisories missing from this response but kept from the previous snapshot.
  - `droppedMissing`: advisories removed after 7 days missing.
  - `changeNotes`: advisories with a "what changed" note.
- **Canada:**
  - `destinations`: number of destinations in the table.
  - `changed`: destinations whose timestamp changed since the previous run.
  - `pagesRead` and `pagesFailed`: destination pages read, and pages that couldn't be read.
  - `notesReused`: notes carried over unchanged.
