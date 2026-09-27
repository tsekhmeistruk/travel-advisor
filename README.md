# Travel Risk Map

A world map of official travel advisory levels from the **U.S. State Department** and the **Government of Canada**. It shows at a glance where the risk is and where the situation changed recently. The data refreshes automatically every day.

**Live site: https://tsekhmeistruk.github.io/travel-advisor/**

## What it shows

- **Risk level by colour:** each country is filled by its advisory level, from 1 (normal precautions) to 4 (do not travel). Countries with no advisory are grey.
- **U.S. / Canada switch** at the top of the map. Each source uses its own level wording, links and data.
- **Recent changes:** countries with a real update in the last 7, 30 or 90 days pulse on the map. Updates that are only wording edits or routine reissues don't count.
- **Change feed:** the "Updated in the last N days" list says what changed, in the source's own words.
- **Details panel:** hover or tap a country to see its level, what the level means, when it was last updated, what changed, whether regional advisories apply, and a link to the official advisory.
- **Settings:** show or hide levels, pick the recent-update window, fade countries without recent updates, and switch between light, dark and auto themes. Settings are remembered in the browser.
- **Search** by any name for a place, including a source's own name (e.g. "Burma"). **Zoom and pan.** The layout works on phones.

## Data sources

| Source | Where the data comes from | Notes |
|---|---|---|
| 🇺🇸 U.S. State Department | [Data API](https://cadataapi.state.gov/api/TravelAdvisories) for levels and dates; [RSS feed](https://travel.state.gov/_res/rss/TAsTWs.xml) for "what changed" notes | The website is behind a bot check. The API is sometimes inconsistent, so each day's result is merged with the previous one: outdated copies are ignored, and missing advisories are kept for 7 days. |
| 🇨🇦 Government of Canada | [travel.gc.ca advisory table](https://travel.gc.ca/travelling/advisories), plus each destination's "Latest updates" line | Canada sometimes re-dates every destination at once for an editorial change. The per-destination note tells real changes apart from those. |

Advisory levels are simplified to 1–4 for both countries. Always read the full official advisory before you travel.

## How it works

1. **Daily, at a random time,** `.github/workflows/update-advisories.yml` runs `node scripts/fetch.mjs <provider>` for each source. A small hourly check picks a pseudo-random hour each day, adds a random 0–39 minute wait, and catches up later that day if a run fails.
2. **Build:** `node scripts/build.mjs` matches every advisory to a place, decides which updates are real and which are minor, records level changes, and writes the site's data (`site/data/`).
3. **Commit, test and deploy:** the bot commits the data and fetch logs, then `.github/workflows/deploy.yml` runs all tests. It deploys `site/` to GitHub Pages **only if every test passes**. If a test fails, the live site keeps its last good version.

If anything fails, the run is marked failed, which sends you an email, and the next hourly check retries. To update immediately, use **Actions → Update advisories → Run workflow**.

The code is organized so that more providers, other datasets (e.g. flight statistics), more languages and a database can be added without restructuring. See **[docs/architecture.md](docs/architecture.md)** for the design, the data formats, and step-by-step guides for each.

## Run locally

Requires Node 22 or newer.

```sh
npm ci              # dev tools for the tests (the site itself has no dependencies)
npm start           # serves site/ at http://localhost:8080
```

The site uses JavaScript modules and loads JSON, which browsers block when a page is opened straight from disk, so use `npm start`.

Refresh the data by hand:

```sh
npm run fetch ca    # one provider (for us: don't repeat quickly, the API rate-limits bursts)
npm run build       # rebuild site/data from config/, data/snapshots/ and data/history/
```

If a source uses a name the build can't match to a place, the build stops and lists it. Add it to `aliases` in `config/providers/<provider>.json`.

## Tests

Every deploy is gated by these tests.

| Suite | Command | What it checks |
|---|---|---|
| Unit | `npm test` | **Parsers** for both sources, against real saved responses (`tests/fixtures/`).<br>**Rules:** U.S. merging, minor-update rules, level history, name-to-place matching.<br>**Site modules:** languages and formatting, settings, advisory logic.<br>**Security helpers:** HTML escaping and link filtering. |
| Data | `npm test` | **Current data:** the published data must equal a fresh build.<br>**Configuration:** the place registry and the configs are consistent.<br>**Plausible sources:** each has ≥150 records and every level.<br>**Translations:** every language has every key. |
| Browser | `npm run test:e2e` | **Both sources** on desktop and phone.<br>**Details card:** stays one fixed size.<br>**Interaction:** clicks with small hand movement, drag to pan, the source switch, search (including "Burma"), and the recent-update filter.<br>**Old settings** still work, and there are no errors or failed requests. |

The browser tests use a local Chrome or Edge (set `CHROME_PATH` to override) and save screenshots to `test-output/`.

## Logs

Every fetch is logged in `logs/fetch/<year>/<year-month>.jsonl`. Each line records every HTTP request (status, timing, retries, Cloudflare challenges) and what the run produced. Each update run's page on GitHub shows the same information as a **Fetch results** table.

```sh
npm run logs        # table of the last 30 days
```

## Project layout

| Path | Purpose |
|---|---|
| `site/` | The published website: HTML, CSS, JavaScript modules, translations (`i18n/`), flags, and generated data (`data/`) |
| `config/` | Hand-edited configuration: the place registry, datasets, and each provider's mapping |
| `data/` | Pipeline state: each provider's latest snapshot, level history, last-run marker |
| `scripts/` | The pipeline: `fetch.mjs`, `build.mjs`, `serve.mjs`, `log-summary.mjs`; providers in `providers/`; logic in `lib/` |
| `tests/` | Unit, data and browser tests, and real-response fixtures |
| `logs/` | Fetch logs, one file per month |
| `docs/` | Architecture and extension guides |
| `.github/workflows/` | `update-advisories.yml` (daily data) and `deploy.yml` (test, then deploy) |
| `.claude/` | Project guide and test skill for Claude Code sessions |

## Setting up your own copy

1. Push the repository to GitHub.
2. Go to **Settings → Actions → General → Workflow permissions** and choose **Read and write**.
3. Go to **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Run **Actions → Update advisories → Run workflow** once.

**Cost:** free on public repositories. On a private repository, the hourly checks and the random wait use about 1,500 of GitHub's 2,000 free Actions minutes a month.

## Credits

- **Advisory data:** [U.S. Department of State](https://travel.state.gov/) and [Government of Canada](https://travel.gc.ca/). This site isn't affiliated with either government.
- **Map geometry:** [Natural Earth](https://www.naturalearthdata.com/) via [world-atlas](https://github.com/topojson/world-atlas) (public domain).
- **Country codes:** ISO 3166-1, mapped with [i18n-iso-countries](https://github.com/michaelwittig/node-i18n-iso-countries) (MIT, used only to generate the place registry).
- **Libraries:** [d3](https://d3js.org/) and [topojson-client](https://github.com/topojson/topojson-client) (ISC licence).
