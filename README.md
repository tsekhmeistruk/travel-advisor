# Travel Risk Map

A world map of official travel advisory levels from the **U.S. State Department** and the **Government of Canada**. It shows at a glance where the risk is and where the situation changed recently. The data refreshes automatically every day.

**Live site: https://tsekhmeistruk.github.io/travel-advisor/**

## What it shows

- **Risk level by colour.** Each country is filled by its advisory level, from 1 (normal precautions) to 4 (do not travel). Countries with no advisory are grey.
- **U.S. / Canada switch** at the top of the map. Each source uses its own level wording, links and data.
- **Recent changes.** Countries with a real update in the last 7, 30 or 90 days pulse on the map. Updates that are only wording edits or routine reissues don't count.
- **Change feed.** The "Updated in the last N days" list says what changed, in the source's own words, e.g. "Risk levels section – avoid all travel to Afar".
- **Details panel.** Hover or tap a country to see its level, what the level means, when it was last updated, what changed, whether regional advisories apply, and a link to the official advisory.
- **Settings:** show or hide levels, pick the recent-update window, fade countries without recent updates, and switch between light, dark and auto themes. Settings are remembered in the browser.
- **Search, zoom and pan.** Small islands and microstates get a dot you can hover. The layout works on phones.

## Data sources

| Source | Where the data comes from | Notes |
|---|---|---|
| 🇺🇸 U.S. State Department | [Data API](https://cadataapi.state.gov/api/TravelAdvisories) for levels and dates; [RSS feed](https://travel.state.gov/_res/rss/TAsTWs.xml) for "what changed" notes | The website itself is behind a bot check. The API is sometimes inconsistent, so each day's result is merged with the previous one (see below). |
| 🇨🇦 Government of Canada | [travel.gc.ca advisory table](https://travel.gc.ca/travelling/advisories), plus each destination's "Latest updates" line | Canada sometimes re-dates all destinations at once for an editorial change. The per-destination note tells real changes apart from those. |

Advisory levels are simplified to 1–4 for both countries. Always read the full official advisory before you travel.

## How the daily update works

The workflow in `.github/workflows/update-advisories.yml` runs every day:

1. **At a random time.** A small check runs every hour and lets the update through once per UTC day, at a pseudo-random hour (00:00–21:59 UTC) plus a random 0–39 minutes. If that run is delayed or fails, a later hour the same day catches up.
2. **Fetch:** `scripts/fetch-us.mjs` and `scripts/fetch-canada.mjs` download each source. If one fails, the other still updates, and the failed one keeps its previous data.
3. **Build:** `scripts/build-data.mjs` joins both sources to the map shapes, decides which updates are real and which are minor, and records level changes in `data/history.json`.
4. **Commit and deploy:** the bot commits the new data and fetch logs, and GitHub Pages redeploys the site.

If anything fails, the run is marked failed, which sends you an email, and the next hourly check retries. To update immediately, use **Actions → Update advisories → Run workflow**.

### Keeping the data trustworthy

- **The U.S. API is inconsistent between calls.** It can leave advisories out, spell names differently, or return an outdated copy of an advisory. Each response is merged into the previous snapshot:
  - names are matched to the ones already on file;
  - an entry older than the saved one is ignored;
  - a missing advisory is kept for 7 days before it's dropped.
- **Minor updates don't count as recent.** Notes such as "Editorial change" or "Reissued after periodic review without changes" are marked as minor (`MINOR_CHANGE` in `build-data.mjs`).
- **Level changes are tracked over time.** When an advisory's level differs from the previous snapshot, the site shows it as "Level 2 → 3" and counts it as a recent update.

## Logs

Every fetch is logged in `logs/fetch/<year>/<year-month>.jsonl`, one line per source per run. A line records every HTTP request (status, timing, retries, Cloudflare challenges) and what the run produced. Each Actions run also shows a **Fetch results** table on its summary page.

```sh
node scripts/log-summary.mjs --days 30   # table of the last 30 days
```

The format is described in [`logs/README.md`](logs/README.md).

## Run locally

Open `index.html` in a browser. There's no build step and nothing to install; the data ships as JavaScript files.

To refresh the data by hand (Node 22 or newer):

```sh
node scripts/fetch-us.mjs       # U.S. -> data/sources/us.json      (don't repeat it quickly: the API rate-limits)
node scripts/fetch-canada.mjs   # Canada -> data/sources/canada.json
node scripts/build-data.mjs     # -> data/advisories.js, data/world.js, data/history.json
```

If a source adds a name the map can't place, `build-data.mjs` stops and lists it. Add it to `SHAPE_ALIASES` in that script.

## Project layout

| Path | Purpose |
|---|---|
| `index.html`, `css/styles.css`, `js/app.js` | The site |
| `scripts/fetch-us.mjs`, `scripts/fetch-canada.mjs` | Download each source |
| `scripts/build-data.mjs` | Match advisories to map shapes, classify updates, track level history |
| `scripts/lib/fetch-log.mjs`, `scripts/log-summary.mjs` | Request logging, and the log table |
| `data/sources/*.json` | Latest snapshot per source (generated) |
| `data/advisories.js`, `data/world.js` | What the site loads (generated) |
| `data/history.json` | Level history per source (generated; keep it committed) |
| `data/countries-50m.json` | Map geometry from [world-atlas](https://github.com/topojson/world-atlas) |
| `logs/fetch/` | Fetch logs, one file per month |
| `vendor/` | d3 v7 and topojson-client, bundled so the page works offline |
| `.github/workflows/update-advisories.yml` | Daily update |
| `.claude/` | Project guide and site checks for Claude Code sessions |

Some places with their own advisory are merged into another country in the base map. `SPLITS` in `js/app.js` separates them: Gaza and the West Bank; French Guiana, Martinique, Guadeloupe, Réunion and Mayotte (from France); Bonaire, Saba and Sint Eustatius (from the Netherlands); the Azores (from Portugal); and the Canary Islands (from Spain).

## Setting up your own copy

1. Push the repository to GitHub.
2. Go to **Settings → Actions → General → Workflow permissions** and choose **Read and write**, so the daily job can commit.
3. Go to **Settings → Pages**, choose **Deploy from a branch**, and select `main` and `/ (root)`.
4. Run **Actions → Update advisories → Run workflow** once, and check the **Fetch results** table.

**Cost:** free on public repositories. On a private repository, the hourly checks and the random wait use about 1,500 of GitHub's 2,000 free Actions minutes a month. To reduce that, shorten the wait (`RANDOM % 40` in the workflow).

## Credits

- **Advisory data:** [U.S. Department of State](https://travel.state.gov/) and the [Government of Canada](https://travel.gc.ca/). This site isn't affiliated with either government. For decisions, rely on the official advisories.
- **Map geometry:** [Natural Earth](https://www.naturalearthdata.com/) via [world-atlas](https://github.com/topojson/world-atlas) (public domain).
- **Libraries:** [d3](https://d3js.org/) and [topojson-client](https://github.com/topojson/topojson-client) (ISC licence).
