# Travel Risk Map

A world map of official travel advisory levels from the **U.S. State Department**, the **Government of Canada** and the **Dutch Ministry of Foreign Affairs**. It shows at a glance where the risk is and where the risk level changed recently. The data refreshes automatically every day.

**Live site: https://tsekhmeistruk.github.io/travel-advisor/**

## What it shows

- **Risk level by colour:** each country is filled by its advisory level, from 1 (normal precautions) to 4 (do not travel). Countries with no advisory are grey.
- **Source switch** (U.S. / Canada / Netherlands) at the top of the map. Each source uses its own level wording, links and data. On phones it shows flags only.
- **Level changes:** a country pulses on the map when its level went up or down in the last 7, 30 or 90 days. Only the level (the colour) counts. Text edits and reissues at the same level don't, and for details the site links to the official advisory.
- **Change feed:** "Level changes in the last N days" lists each change, e.g. "▲ Level 2 → 3", newest first.
- **Details panel:** hover or tap a country to see its level, what the level means, when the source last updated it, its level history (the last three changes), whether regional advisories apply, and a link to the official advisory.
- **Settings:** show or hide levels, pick the level-change window, fade countries without a recent level change, and switch between light, dark and auto themes. Settings are remembered in the browser.
- **Search** by any name for a place, including a source's own name (e.g. "Burma"). **Zoom and pan.** The layout works on phones.

## Data sources

| Source | Where the data comes from | Notes |
|---|---|---|
| 🇺🇸 U.S. State Department | [Data API](https://cadataapi.state.gov/api/TravelAdvisories) for levels and dates | The website is behind a bot check. The API is sometimes inconsistent, so each day's result is merged with the previous one: outdated copies are ignored, a **level change is applied only when the next day's fetch confirms it**, and missing advisories are kept for 7 days. |
| 🇨🇦 Government of Canada | [Official open-data JSON feed](https://open.canada.ca/data/dataset/bef2ebb3-ca9a-485f-aaff-5dc36eb89426) (Global Affairs Canada, Open Government Licence – Canada), plus the live [advisory table](https://travel.gc.ca/travelling/advisories) | The feed gives every destination and its level in one request. It's rebuilt about once a day, so the live table catches anything newer. Either source alone is enough. |
| 🇳🇱 Netherlands, Ministry of Foreign Affairs | [Open-data API v2](https://opendata.nederlandwereldwijd.nl/v2/sources/nederlandwereldwijd/infotypes/traveladvice) (CC0) | The colour code is read from the Dutch summary text, because the API has no level field: green, yellow, orange and red become levels 1–4. For regional advisories, the "rest of the country" colour is the headline level. A level change is applied only when the next day's fetch confirms it. |

Advisory levels are simplified to 1–4 for every source. Always read the full official advisory before you travel.

**Level history:** the site records each source's levels once a day and compares them with the day before, so it knows about level changes from **Sep 26, 2026**, when tracking began. For the U.S., ten earlier changes were added once from the State Department's own change notes, e.g. "The advisory level was increased to 4" (Chad, Apr 28, 2026). Where a note gave only the direction, the card says "Raised to Level 4" rather than "Level 3 → 4".

## How it works

1. **Daily, at a random time,** `.github/workflows/update-advisories.yml` runs `node scripts/fetch.mjs <provider>` for each source. A small hourly check picks a pseudo-random hour each day, adds a random 0–39 minute wait, and catches up later that day if a run fails.
2. **Build:** `node scripts/build.mjs` matches every advisory to a place, compares each level with the level history to record changes, and writes the site's data (`site/data/`).
3. **Commit, test and deploy:** the bot commits the data and fetch logs, then `.github/workflows/deploy.yml` runs all tests. It deploys `site/` to GitHub Pages **only if every test passes**. If a test fails, the live site keeps its last good version.

If anything fails, the run is marked failed, which sends you an email, and the next hourly check retries. To update immediately, use **Actions → Update advisories → Run workflow**.

The code is organized so that more providers, other datasets (e.g. flight statistics), more languages and a database can be added without restructuring. See **[docs/architecture.md](docs/architecture.md)** for the design, the data formats, and step-by-step guides for each.

## Run locally

Requires Node 22 or newer.

```sh
npm ci              # dev tools for the tests (the site itself has no dependencies)
npm start           # serves site/ at http://localhost:8080
npm run test:all    # every test (see Tests)
```

The site uses JavaScript modules and loads JSON, which browsers block when a page is opened straight from disk, so use `npm start`.

Refresh the data by hand:

```sh
npm run fetch ca    # one provider (for us: don't repeat quickly, the API rate-limits bursts)
npm run build       # rebuild site/data from config/, data/snapshots/ and data/history/
```

If a source uses a name the build can't match to a place, the build stops and lists it. Add it to `aliases` in `config/providers/<provider>.json`.

## Tests

Every deploy is gated by these tests (292 in total). Coverage is enforced: deploys fail if unit and data tests cover less than 90% of lines. See [tests/README.md](tests/README.md) for the layout and conventions.

| Suite | Command | What it checks |
|---|---|---|
| Unit | `npm test` | **Parsers** for every source, against real saved responses (`tests/fixtures/`).<br>**Fetchers:** retries, Cloudflare challenges and fallbacks between sources, against scripted responses.<br>**Rules:** merging and confirming level changes, level history, name-to-place matching.<br>**Infrastructure:** run log, storage, log summary, and the local server's path safety.<br>**Site modules:** languages, settings, search, and the advisory dataset's views, including escaping hostile source text and rejecting unsafe links. |
| Data | `npm test` | **Current data:** the published data must equal a fresh build.<br>**Configuration:** the place registry and the configs are consistent.<br>**Plausible sources:** each has ≥150 records and every level.<br>**Translations:** every language has every key, and every key the code uses exists.<br>**Wiring:** every provider is set up everywhere it must be, including the daily workflow.<br>**Deploy gate:** it's intact.<br>**Secrets:** none are committed. |
| Browser | `npm run test:e2e` | **Both sources** on desktop and phone.<br>**Details card:** stays one fixed size.<br>**Every control:** clicks with small hand movement, drag, zoom buttons, tooltip, theme, panel, level filter, fading, feed, keyboard search.<br>**Error states:** the load-error message.<br>**Accessibility:** every control has an accessible label.<br>**Languages:** a fake second, right-to-left locale proves the language picker, persistence, and translated names and dates. |

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
