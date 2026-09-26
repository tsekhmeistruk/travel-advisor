# Travel Risk Map: project guide

A static site: a world map of travel advisory levels from the **U.S. State Department** and the **Government of Canada**, with a source switch, a recent-change feed and a details panel. GitHub Actions refreshes the data daily.

- **Live:** https://tsekhmeistruk.github.io/travel-advisor/ (GitHub Pages, deployed from `main`, root)
- **Repo:** https://github.com/tsekhmeistruk/travel-advisor (public)
- **`gh`:** installed at `C:\Program Files\GitHub CLI\gh.exe` and signed in. It may not be on PATH in agent shells, so call it by full path.

## Before you start

- **`git pull` first.** A bot commits new data and logs to `main` every day.
- **Pushing to `main` deploys the live site** within about a minute.

## How it fits together

```
fetch-us.mjs ─→ data/sources/us.json ─┐
fetch-canada.mjs ─→ data/sources/canada.json ─┼─→ build-data.mjs ─→ data/advisories.js  ─→ index.html + js/app.js
                    data/history.json ────────┘        (+ data/world.js from countries-50m.json)
every fetch ─→ logs/fetch/<YYYY>/<YYYY-MM>.jsonl ─→ log-summary.mjs (run page table / terminal)
```

- **No build step and no npm dependencies in the repo.** `index.html` works straight from disk, because the data ships as `.js` files that set `window.ADVISORY_DATA` and `window.WORLD_TOPO`. d3 v7 and topojson-client are vendored in `vendor/`. Scripts use only Node built-ins (Node 22+).
- **Generated files: never edit by hand.** These are `data/advisories.js`, `data/world.js`, `data/history.json` and the log `.jsonl` files. Change the scripts and run `node scripts/build-data.mjs`.
- `travel_advisories.md` is the original hand-made U.S. export. It is no longer used.

## Where the logic lives

| Concern | Place |
|---|---|
| Advisory name → map shape | `SHAPE_ALIASES` in `scripts/build-data.mjs`. The build fails and lists any name it can't place. |
| Dots for places missing from the map | `POINT_ONLY` in `build-data.mjs` |
| Shapes covered by another advisory, per source | `SOURCES.<key>.coveredBy` in `build-data.mjs` |
| Level names and descriptions, per source | `SOURCES.<key>.levels` in `build-data.mjs` |
| Minor-update rules (editorial, routine reissue) | `MINOR_CHANGE` and `classifyUpdates()` in `build-data.mjs` |
| Level-change history | `trackHistory()` in `build-data.mjs` |
| Splitting merged map shapes (Gaza/West Bank, French overseas departments, Caribbean Netherlands, Azores, Canary Islands) | `SPLITS` in `js/app.js`. If you add a split shape, also add it to `SPLIT_SHAPES` in `build-data.mjs`. |
| What counts as "recent" | `isRecent()` and `recentDate()` in `js/app.js` |
| Daily random-time schedule | `.github/workflows/update-advisories.yml` (hourly gate job and `data/last-run.txt`) |
| Request logging | `scripts/lib/fetch-log.mjs`. Every network call goes through `log.request()`. |

## Source quirks (learned the hard way)

**U.S.** comes from `cadataapi.state.gov/api/TravelAdvisories`, the State Department's JSON API.

- **The travel.state.gov page is behind a Cloudflare bot check.** It returned 403 even to a single request. Don't scrape it, and don't try to get past the check.
- **The RSS feed** (`travel.state.gov/_res/rss/TAsTWs.xml`) lags the page for some countries. It's used only for "what changed" notes, and only when its date matches the API's within a day.
- **The API is inconsistent between calls:**
  - some advisories are missing (216–228 items);
  - names change spelling ("Cote d Ivoire");
  - it sometimes serves an **outdated copy**, e.g. Bangladesh at Level 3 from January instead of Level 2 from July.

  `fetch-us.mjs` merges each response into the previous snapshot to handle this: names are canonicalized, an older date than the saved one is ignored, and a missing advisory is kept for 7 days.
- **The API rate-limits bursts.** A few calls in a row led to HTTP 429 and a Cloudflare challenge for 20+ minutes. **Don't run `fetch-us.mjs` repeatedly while testing.** From GitHub Actions, a single daily call works.
- API dates are 20:00 U.S. Eastern. The UTC date matches the page's "Date Updated" (winter dates can be a day off).

**Canada** comes from the table on `travel.gc.ca/travelling/advisories`.

- **Canada sometimes re-stamps every page at once.** On Sep 24, 2026, 223 of 230 destinations got the same timestamp for a "Health – editorial change". The real change description is the "Latest updates" line (`#lastUpdateTextLbl`) on each destination's page.
  - `fetch-canada.mjs` re-reads only the pages whose timestamp changed since the previous snapshot.
  - `build-data.mjs` marks editorial-only notes as minor.
  - Without a note, it falls back to the rule that a date shared by more than 40% of entries is a bulk republish.
- Canada's single "Israel and Palestine" advisory covers three shapes: Israel, Gaza and the West Bank.

## UI conventions

- **The details card is a fixed height** (398px), with fixed slots: a one-line title, a three-line description, a four-line "What changed" block and a one-line status row. The panel below must never jump as the pointer moves between countries. Long text is clamped, and the full text is in the `title` attribute.
- **Colours are CSS tokens** on `:root`, with dark mode through `prefers-color-scheme` and `[data-theme]`. Level colours are `--l1` to `--l4`.
- **Map zoom uses `clickDistance(6)`.** d3-zoom's default of 0 swallowed clicks that had tiny hand movement. The selection outline is drawn above the hover outline.
- **Settings persist in `localStorage`** under `travel-risk-map:settings`, with every read and write wrapped in try/catch.

## Verifying changes

- **Site changes:** use the **`verify-site`** skill (`.claude/skills/verify-site/`). It runs headless-browser checks for both sources, the card size, clicks and drags, the source switch, search and the mobile layout. Install puppeteer-core in the scratchpad, not the repo.
- **Data scripts:** run `node scripts/build-data.mjs`. It validates every advisory against the map.
- **Fetch health:** `node scripts/log-summary.mjs --days 30`, or the **Fetch results** table on each Actions run page.
- **Workflow changes:** push, then trigger it with `gh workflow run update-advisories.yml --ref main`. Watch it with `gh run watch <id>`, then `git pull` to see the committed log.

## Adding a new source

1. Write `scripts/fetch-<key>.mjs`. Output `{ fetchedAt, source, entries: [{ name, level 1–4, updated 'YYYY-MM-DD', url, change?, regional? }] }` to `data/sources/<key>.json`. Wrap the script in `withRunLog('<key>', …)`, and route every request through `log.request()`.
2. Add `<key>` to `SOURCE_FILES` and `SOURCES` in `build-data.mjs` (label, agency, link, home, coveredBy, territories, levels). Add aliases until the build passes.
3. Add a flag and short label in the `FLAGS` and `SHORT_LABELS` sections of `js/app.js`. Add labels in `scripts/log-summary.mjs`.
4. Add a fetch step for it in the workflow (`continue-on-error`, with an id), and include it in the `last-run.txt` and "Report failures" conditions.
