# Travel Risk Map

World map of travel advisory levels from the U.S. State Department and the Government of Canada. A switch at the top of the map flips between the two sources. The map highlights advisories that were updated recently.

## Run

Open `index.html` in a browser. No server or build step is needed.

## Update the data

GitHub Actions updates the data automatically every day (see below). To update by hand:

```sh
node scripts/fetch-us.mjs       # U.S. State Department data API -> data/sources/us.json
node scripts/fetch-canada.mjs   # travel.gc.ca advisory table    -> data/sources/canada.json
node scripts/build-data.mjs     # rebuild data/advisories.js (both sources) and data/world.js
```

- **U.S.:** `fetch-us.mjs` reads `cadataapi.state.gov/api/TravelAdvisories`. The travel.state.gov page is behind a bot check, and its RSS feed lags the page for some countries. The API matches the page's levels, and its dates match to within a day.
  - The API's responses vary from call to call: advisories can be missing or spelled differently. Each run is merged into the previous snapshot. A missing advisory is kept for up to 7 days, and names are matched to the ones already on file.
  - The API rate-limits repeated calls (HTTP 429 or a Cloudflare challenge), so avoid running the script many times in a row.
  - The "what changed" note comes from the RSS feed, and is used only when the feed's date matches the API's.
- **Canada:** `fetch-canada.mjs` reads the table on travel.gc.ca. For destinations whose timestamp changed since the last run, it also reads the "Latest updates" note from the destination's page. Usually that's only a few pages a day.
- **Minor updates:** `build-data.mjs` flags updates whose note is only an editorial change or a routine reissue (`MINOR_CHANGE`). These don't count as recent updates.
- **Failures:** both fetch scripts fail loudly if the source's format changes.
- **Unmatched names:** `build-data.mjs` fails and lists any advisory name it can't place on the map. Add the name to `SHAPE_ALIASES`.

`travel_advisories.md` was the original hand-made U.S. export. It is no longer used.

## Daily automatic updates

`.github/workflows/update-advisories.yml` refreshes both sources once a day at a random time and commits the result:

- **Hourly check:** a small check job runs every hour. It lets the update through once per UTC day, at a pseudo-random hour picked from the date (00:00–21:59 UTC).
- **Random minute:** the on-time run then waits a random 0–39 minutes before fetching.
- **Catch-up:** if a run is delayed, dropped or fails, a later hour the same day retries without waiting. `data/last-run.txt` records the last day both sources refreshed.
- **Partial failures:** if one source fails, the other still updates. The run is marked failed, so GitHub emails you.
- **Manual run:** use **Actions → Update advisories → Run workflow**. It updates immediately.

### Logs

Every fetch run is logged to `logs/fetch/<year>/<year-month>.jsonl`, and the daily run commits it with the data. Each line records every HTTP request, with status, timing, retries and any Cloudflare challenge, plus what the run produced. Each GitHub run's summary page shows the same information as a **Fetch results** table.

```sh
node scripts/log-summary.mjs --days 30   # table of the last 30 days
```

`logs/README.md` describes the log format.

**Setup:** push the project to a GitHub repository. Then set **Settings → Actions → General → Workflow permissions** to **Read and write**, so the workflow can commit. Scheduled workflows only run on the default branch.

**Cost:** free on public repositories. On private repositories, each hourly check bills about 1 minute, and the daily update bills up to about 40 minutes. That adds up to roughly 1,500 of the 2,000 free minutes a month. For a private repository, reduce the random wait (`RANDOM % 40`) or the check frequency.

**Hosting:** to publish the site, enable **Settings → Pages → Deploy from a branch** (`main`, `/ (root)`). The daily commits then redeploy it automatically.

### Level history

Each build appends any level change to `data/history.json`. Commit this file so the history builds up over time. Once an advisory has two snapshots with different levels, the site shows the change (for example "Level 2 → 3") and counts it as a recent update.

Canada stamps the same "last updated" date on nearly every destination whenever the whole site is republished. The build treats a date shared by over 40% of entries as a bulk republish. It doesn't count those dates as recent updates, so for Canada, the level history is the reliable change signal.

## Layout

| Path | Purpose |
|---|---|
| `index.html`, `css/styles.css`, `js/app.js` | The site |
| `scripts/fetch-us.mjs` | Downloads U.S. advisories from the State Department API |
| `scripts/fetch-canada.mjs` | Downloads and parses Canada's advisories |
| `.github/workflows/update-advisories.yml` | Daily update at a random time |
| `data/sources/us.json` | Latest U.S. snapshot |
| `scripts/build-data.mjs` | Joins both sources to map shapes and tracks level history |
| `scripts/lib/fetch-log.mjs` | Shared request logging for the fetch scripts |
| `scripts/log-summary.mjs` | Renders the fetch log as a table (GitHub run page or terminal) |
| `logs/fetch/` | Fetch log, one file per month |
| `data/sources/canada.json` | Latest Canadian snapshot |
| `data/history.json` | Level history per source and advisory |
| `data/countries-50m.json` | Map geometry from [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth, public domain) |
| `vendor/` | d3 v7 and topojson-client, bundled so the page works offline |

Split shapes: the base map merges some places that have their own advisory. `SPLITS` in `js/app.js` separates Gaza and the West Bank; French Guiana, Martinique, Guadeloupe, Réunion and Mayotte from France; Bonaire, Saba and Sint Eustatius from the Netherlands; the Azores from Portugal; and the Canary Islands from Spain.
