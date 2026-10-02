# Risk Monitor

A world map that monitors countries for changes that matter to travellers: official travel advisory levels from the **U.S. State Department**, the **Government of Canada**, the **Dutch Ministry of Foreign Affairs**, the **UK Foreign Office** and the **German Foreign Office**, disaster alerts (GDACS), outbreak notices (WHO) and unusual news activity (GDELT). It shows at a glance where the risk is and what changed recently. The data refreshes automatically several times a day. (It began as the "Travel Risk Map"; the repository keeps that name.)

**Live site: https://tsekhmeistruk.github.io/travel-advisor/**

## What it shows

- **Map modes:** **Travel** (official advisories, below), **Highest** (the highest risk level of any category), **Disasters** (GDACS alerts) and **Changes** (where a risk level changed recently). The risk modes use one scale, Normal, Elevated, High and Critical, which is our summary of the sources, not an official level. Their card shows each category's level and what set it, e.g. "3 of 5 governments" or "GDACS Orange tropical cyclone". The travel level is the one that at least two governments give, so one government alone doesn't set it; a stricter government is shown by its flag. **Country details** opens a full view of a country: every category, active alerts, each government's advisory in its own words, and its changes over up to a year; **Share** sends or copies a link to it. **All countries** lists every place with its level, sorted by level, last change or name, with a filter. **Event markers** show GDACS alerts on the map, grouped when they are close. A link like `#mode=disaster&place=mx` opens a mode and a country.
- **Risk level by colour:** each country is filled by its advisory level, from 1 (normal precautions) to 4 (do not travel). Countries with no advisory are grey.
- **Mode switch** at the top of the map, and in Travel the **source switch** (U.S. / Canada / Netherlands / U.K. / Germany) below it. Each source uses its own level wording, links and data. On phones it shows flags only.
- **Level changes:** a country pulses on the map when its level went up or down in the last 7, 30 or 90 days. Only the level (the colour) counts. Text edits and reissues at the same level don't, and for details the site links to the official advisory.
- **Change feed:** "Level changes in the last N days" lists each change, e.g. "▲ Level 2 → 3", newest first; the overview card shows the three latest. The risk modes list level changes and new or changed alerts. An empty period offers a longer one.
- **Unusual news activity:** where protests or violence are in the news far more than usual (GDELT), listed on its own below the feed; it is never a level or a change.
- **Details panel:** hover or tap a country to see its level, what the level means, when the source last updated it, its level history (the last three changes), whether regional advisories apply, and a link to the official advisory.
- **Filters** (below the feed, collapsed until opened): show or hide levels, pick the level-change window, fade countries without a recent level change. A theme switch offers light, dark and auto. All of it is remembered in the browser.
- **How levels work:** the ⓘ in the legend explains the scale and its sources. The header warns when the data is older than it should be.
- **Search** (press `/`) by any name for a place, including a source's own name (e.g. "Burma"), and in the risk modes for an active alert by name (e.g. a cyclone). **Zoom and pan;** zoomed in, the map names the countries. The layout works on phones: a tap on the map shows the place in a sheet over the map, with a Details button.

## Data sources

| Source | Where the data comes from | Notes |
|---|---|---|
| 🇺🇸 U.S. State Department | [Data API](https://cadataapi.state.gov/api/TravelAdvisories) for levels and dates | The website is behind a bot check. The API is sometimes inconsistent, so each day's result is merged with the previous one: outdated copies are ignored, a **level change is applied only when the next day's fetch confirms it**, and missing advisories are kept for 7 days. |
| 🇨🇦 Government of Canada | [Official open-data JSON feed](https://open.canada.ca/data/dataset/bef2ebb3-ca9a-485f-aaff-5dc36eb89426) (Global Affairs Canada, Open Government Licence – Canada), plus the live [advisory table](https://travel.gc.ca/travelling/advisories) | The feed gives every destination and its level in one request. It's rebuilt about once a day, so the live table catches anything newer. Either source alone is enough. |
| 🇳🇱 Netherlands, Ministry of Foreign Affairs | [Open-data API v2](https://opendata.nederlandwereldwijd.nl/v2/sources/nederlandwereldwijd/infotypes/traveladvice) (CC0) | The colour code is read from the Dutch summary text, because the API has no level field: green, yellow, orange and red become levels 1–4. For regional advisories, the "rest of the country" colour is the headline level. A level change is applied only when the next day's fetch confirms it. |

| 🇬🇧 UK Foreign, Commonwealth & Development Office | [GOV.UK Content API](https://www.gov.uk/api/content/foreign-travel-advice) (Open Government Licence v3.0) | The FCDO has no 1–4 scale; its warnings are mapped: none 1, "all but essential travel to parts" 2, "all travel to parts" 3 (also, rarely, "all but essential travel to the whole country"), "all travel to the whole country" 4. The site shows the FCDO's own wording. Only pages that changed since the day before are fetched. |
| 🇩🇪 German Federal Foreign Office | [Open-data API](https://www.auswaertiges-amt.de/opendata/travelwarning), one request a day | Germany has no 1–4 scale; its flags are mapped: none 1, travel to parts advised against 2, partial travel warning (Teilreisewarnung) or travel to the whole country advised against 3, travel warning (Reisewarnung) 4. Names are German, so places are matched by ISO code. Overseas territories without their own entry fall under their country's (e.g. Greenland under Denmark). |

Advisory levels are simplified to 1–4 for every source. Always read the full official advisory before you travel.

**Risk monitor (in progress).** The site is growing beyond travel advisories into several risk categories per country (travel, disasters, wildfires and health today; security, unrest and more later), each with its own sources and level history:

| Source | Where the data comes from | Notes |
|---|---|---|
| 🌐 WHO Disease Outbreak News | [WHO API](https://www.who.int/emergencies/disease-outbreak-news), every 6 hours | Official notices of outbreaks of international concern. A notice raises the Health category to Elevated for 30 days; the site keeps only its title, date and link, and links to WHO for the text. Global and regional notices are listed on no country. |
| 🌐 GDELT Project | [Daily event files](https://www.gdeltproject.org/data.html) (free for any use with a citation and a link), once a day | News reports of protests and violence, coded by machine, counted per country and day. Used only to spot **unusual activity** (this week against the country's own last 12 weeks), shown as a labelled line ("News: protest reports far above normal"), **never as a risk level**: these are news reports, not verified incidents. |
| 🌐 GDACS (UN OCHA, UNOSAT and the European Commission) | [GDACS API](https://www.gdacs.org/gdacsapi/swagger/index.html), Orange and Red alerts of the last 30 days, hourly | Earthquakes, cyclones, floods, volcanoes, droughts and forest fires. GDACS alerts are automatic estimates, "purely indicative", and don't replace national authorities ([terms](https://www.gdacs.org/documents/2025/GDACS_Terms_of_use_Mar_25.pdf)). |

**Level history:** the site records each source's levels once a day and compares them with the day before, so it knows about level changes from **Sep 26, 2026**, when tracking began. For the U.S., ten earlier changes were added once from the State Department's own change notes, e.g. "The advisory level was increased to 4" (Chad, Apr 28, 2026). Where a note gave only the direction, the card says "Raised to Level 4" rather than "Level 3 → 4".

## How it works

1. **Hourly,** `.github/workflows/update.yml` asks `scripts/due.mjs` what is due (`config/schedule.json`) and runs `node scripts/fetch.mjs <id>` for it. Travel advisories are fetched once a day at a pseudo-random hour, with a random 0–39 minute wait, and caught up later that day if a fetch fails. GDACS is fetched every hour.
2. **Build:** `node scripts/build.mjs` matches every advisory to a place, compares each level with the level history to record changes, derives the risk signals and their changes, and writes the site's data (`site/data/`).
3. **Commit, test and deploy:** the bot commits the data and fetch logs, then `.github/workflows/deploy.yml` runs all tests. It deploys `site/` to GitHub Pages **only if every test passes**. If a test fails, the live site keeps its last good version.

If anything fails, the run is marked failed, which sends you an email, and the next hourly run retries. To update immediately, use **Actions → Update data → Run workflow** (optionally naming only some sources, e.g. `gdacs`). GitHub runs scheduled workflows late or not at all under load, so for dependable hourly updates an external scheduler can start the workflow through the API with `sources` set to `due`, which fetches only what is due, like a scheduled run.

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

Every deploy is gated by these tests (over 600 in total). Coverage is enforced: deploys fail if unit and data tests cover less than 90% of lines. See [tests/README.md](tests/README.md) for the layout and conventions.

| Suite | Command | What it checks |
|---|---|---|
| Unit | `npm test` | **Parsers** for every source, against real saved responses (`tests/fixtures/`).<br>**Fetchers:** retries, Cloudflare challenges and fallbacks between sources, against scripted responses.<br>**Rules:** merging and confirming level changes, level history, name-to-place matching.<br>**Infrastructure:** run log, storage, log summary, and the local server's path safety.<br>**Site modules:** languages, settings, search, and the advisory dataset's views, including escaping hostile source text and rejecting unsafe links. |
| Data | `npm test` | **Current data:** the published data must equal a fresh build.<br>**Configuration:** the place registry and the configs are consistent.<br>**Plausible sources:** each has ≥150 records and every level.<br>**Translations:** every language has every key, and every key the code uses exists.<br>**Wiring:** every provider is set up everywhere it must be, including the daily workflow.<br>**Deploy gate:** it's intact.<br>**Secrets:** none are committed. |
| Browser | `npm run test:e2e` | **Every source** (read from the manifest) on desktop and phone, with injected level changes of known ages, so pulses and the feed are always tested.<br>**Details card:** stays one fixed size.<br>**Every control:** clicks with small hand movement, drag, zoom buttons, tooltip, theme, panel, level filter, fading, feed, keyboard search.<br>**Error states:** the load-error message.<br>**Accessibility:** every control has an accessible label.<br>**Languages:** a fake second, right-to-left locale proves the language picker, persistence, and translated names and dates. |

The browser tests use a local Chrome or Edge (set `CHROME_PATH` to override) and save screenshots to `test-output/`.

## Dev tools

```sh
npm run shots                                  # screenshots of every mode (desktop light, phone dark) to test-output/shots/
npm run shots -- 'europe=#mode=highest&place=de' --phone --dark   # any view; see scripts/tools/screenshots.mjs
npm run live-check                             # the live site in every mode: console errors, header, card
npm run merge-bot-data                         # after git fetch: merge the bot's data commits and rebuild
npm run tick -- docs/plans/<plan>.md 1.1,1.2   # tick a plan checklist
```

## Logs

Every fetch is logged in `logs/fetch/<year>/<year-month>.jsonl`. Each line records every HTTP request (status, timing, retries, Cloudflare challenges) and what the run produced. Each update run's page on GitHub shows the same information as a **Fetch results** table, which starts with "🔔 level changed: …" when a source's level moved.

```sh
npm run logs        # table of the last 30 days
```

## Project layout

| Path | Purpose |
|---|---|
| `site/` | The published website: HTML, CSS, JavaScript modules, translations (`i18n/`), flags, and generated data (`data/`) |
| `config/` | Hand-edited configuration: the place registry, datasets, each provider's mapping, risk categories and sources, the fetch schedule |
| `data/` | Pipeline state: each provider's latest snapshot, level history, risk events, signals and change log, each source's last success |
| `scripts/` | The pipeline: `fetch.mjs`, `build.mjs`, `serve.mjs`, `log-summary.mjs`; providers in `providers/`; logic in `lib/` |
| `tests/` | Unit, data and browser tests, and real-response fixtures |
| `logs/` | Fetch logs, one file per month |
| `docs/` | Architecture and extension guides |
| `.github/workflows/` | `update.yml` (hourly data) and `deploy.yml` (test, then deploy) |
| `.claude/` | Project guide and test skill for Claude Code sessions |

## Setting up your own copy

1. Push the repository to GitHub.
2. Go to **Settings → Actions → General → Workflow permissions** and choose **Read and write**.
3. Go to **Settings → Pages** and set **Source** to **GitHub Actions**.
4. Run **Actions → Update data → Run workflow** once.

**Cost:** free on public repositories. On a private repository, the hourly fetches, builds and test runs would use more than GitHub's 2,000 free Actions minutes a month; set GDACS to a longer interval in `config/schedule.json`.

## Credits

- **Advisory data:** [U.S. Department of State](https://travel.state.gov/), [Government of Canada](https://travel.gc.ca/) and the [Dutch Ministry of Foreign Affairs](https://www.nederlandwereldwijd.nl/reisadvies) (open data, CC0). This site isn't affiliated with any of these governments.
- **German travel warnings:** [Auswärtiges Amt](https://www.auswaertiges-amt.de/de/ReiseUndSicherheit/reise-und-sicherheitshinweise), open-data API. Not affiliated.
- **UK travel advice:** contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) (Foreign, Commonwealth & Development Office). Not affiliated.
- **News activity:** [The GDELT Project](https://www.gdeltproject.org/). Counts of news reports, not verified incidents. Not affiliated.
- **Outbreak notices:** [WHO Disease Outbreak News](https://www.who.int/emergencies/disease-outbreak-news), World Health Organization. Titles, dates and links only. Not affiliated.
- **Disaster alerts:** [GDACS](https://www.gdacs.org/), the Global Disaster Alert and Coordination System (UN OCHA, UNOSAT and the European Commission). Not affiliated.
- **Map geometry:** [Natural Earth](https://www.naturalearthdata.com/) via [world-atlas](https://github.com/topojson/world-atlas) (public domain).
- **Country codes:** ISO 3166-1, mapped with [i18n-iso-countries](https://github.com/michaelwittig/node-i18n-iso-countries) (MIT, used only to generate the place registry).
- **Libraries:** [d3](https://d3js.org/) and [topojson-client](https://github.com/topojson/topojson-client) (ISC licence).
