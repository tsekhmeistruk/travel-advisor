# Architecture

This project is a map of the world that shows **data about places**. Today the data is official travel-advisory levels from the U.S. and Canada. The code is built so that more **providers** (other governments), other **datasets** (flights, statistics), more **languages** and a **database** can be added without restructuring.

## Principles

- **Data is facts, text is translations.** Published data holds IDs, numbers, dates and the source's own notes. All interface text, including each provider's level wording, lives in `site/i18n/<locale>.json`.
- **Everything refers to places by ID.** The place registry (`config/places.json`) is shared by every dataset.
- **The map is generic.** It draws places and asks the active dataset how each one should look. It knows nothing about advisories.
- **Pure logic, thin I/O.** Parsing, merging, classification and view rules are pure functions with unit tests. Scripts and UI glue only read, write and render.
- **One storage boundary.** The pipeline touches files only through `scripts/lib/store.mjs`, and the site loads data only through `site/js/core/data-client.js`. These are the two seams where a database or API plugs in.
- **Nothing deploys untested.** Every deploy runs the unit, data and browser tests first.

## Concepts

| Concept | What it is | Where |
|---|---|---|
| **Place** | Something drawn on the map: a country, territory or split region. It has a stable `id` (`fr`, `gaza`), an English `name`, an optional ISO `iso2` code, and a map `shape` or a `point` | `config/places.json`, published as `site/data/places.json` |
| **Dataset** | A kind of data shown on the map, e.g. `travel-advisories`. It defines its scale, its providers and its settings | `config/datasets/<id>.json`, plus a site module in `site/js/datasets/<id>/` |
| **Provider** | One source within a dataset, e.g. `us` or `ca` | `config/providers/<id>.json` and `scripts/providers/<id>/` |
| **Record** | One item from a provider, e.g. one advisory. It refers to its places by ID | `site/data/<dataset>/<provider>.json` |
| **Target** | What the user is pointing at: `{ placeId }` or `{ recordKey }` (a record with no place, e.g. "French West Indies") | `site/js/main.js` |
| **Locale** | A language file | `site/i18n/<code>.json` |

## Repository layout

```
config/                        hand-edited configuration (future: reference tables)
  places.json                  place registry (generated once by scripts/tools/generate-places.mjs, then reviewed)
  datasets/<id>.json           dataset definition: scale, providers, settings options
  providers/<id>.json          provider mapping: home, territories, coveredBy, aliases, list-only entries
data/                          pipeline state (future: database tables)
  snapshots/<dataset>/<p>.json latest fetch of each provider
  history/<dataset>.json       level history per provider and record
  last-run.txt                 last day the daily update fully succeeded
logs/fetch/<yyyy>/<yyyy-mm>.jsonl   one line per fetch run (see logs/README.md)
scripts/                       the data pipeline (Node 22, no dependencies)
  fetch.mjs <provider>         fetch one provider into its snapshot
  build.mjs                    build site/data from config + snapshots + history
  serve.mjs                    local static server for site/
  log-summary.mjs              fetch log as a table
  lib/                         pure logic: build.mjs, text.mjs; I/O boundary: store.mjs; logging: fetch-log.mjs
  providers/<id>/              index.mjs (network + minor-change rules), parse.mjs (pure parsing)
  tools/generate-places.mjs    regenerates config/places.json
site/                          the published website: deployed as-is
  index.html, css/, vendor/ (d3, topojson), assets/flags/
  i18n/<locale>.json           all interface text
  data/                        published data: manifest.json, places.json, <dataset>/<provider>.json, geo/
  js/
    main.js                    composition root: loads data, creates the dataset and map, wires the panel
    core/                      i18n, settings, data client, DOM helpers (pure except dom.js)
    map/                       world-map.js (generic map), splits.js (map geometry fixes)
    datasets/                  registry.js (dataset interface), travel-advisories/ (logic.js pure, index.js views)
    ui/                        search, provider switch, theme, language picker, tooltip
tests/
  unit/pipeline, unit/site     pure logic, with real-response fixtures in tests/fixtures/
  data/                        published data vs a fresh build, config and translation checks
  e2e/                         headless browser over the served site
```

## Data flow

```
                ┌───────────────┐    ┌────────────────────────┐    ┌──────────────────────────┐
 provider site ─► fetch.mjs <p> ├───►│ data/snapshots/…/p.json│──┐ │ build.mjs                │
                └───────────────┘    └────────────────────────┘  ├►│  resolve names → places  ├──► site/data/*.json ──► browser
            config/places.json, datasets/*, providers/* ─────────┤ │  classify minor updates  │
            data/history/<dataset>.json ◄──────────────────────────┤  track level history     │
                                                                   └──────────────────────────┘
```

1. **Fetch** (`scripts/fetch.mjs <provider>`) loads the provider module, gives it the previous snapshot, and saves the new one. Each provider decides how to fetch and how to merge. For example, the U.S. provider ignores stale API copies and keeps advisories that are temporarily missing. Every request is logged.
2. **Build** (`scripts/build.mjs` → `buildSite()` in `lib/build.mjs`) does three things:
   - matches each record's title to places: the provider's `listOnly` entries first, then its `aliases`, then an automatic match on the place's name or map shape, ignoring accents and punctuation;
   - flags minor updates using the provider's `minorChange` patterns, with a bulk-date fallback;
   - updates the level history.

   It **fails** if anything can't be placed.
3. **Publish:** the build writes the files the site loads. The data test checks that they equal a fresh build.

### Published formats

`site/data/manifest.json`: what exists.

```json
{ "defaultLocale": "en", "locales": ["en"], "places": "places.json", "geo": "geo/countries-50m.json",
  "datasets": [{ "id": "travel-advisories", "scale": { "type": "levels", "values": [1,2,3,4] },
                 "recentWindows": [0,7,30,90], "defaultRecentWindow": 30,
                 "providers": [{ "id": "us", "flag": "us", "asOf": "2026-09-26", "file": "travel-advisories/us.json" }] }] }
```

`site/data/travel-advisories/<provider>.json`: one provider's records.

```json
{ "dataset": "travel-advisories", "provider": "ca", "asOf": "2026-09-26", "source": "https://…",
  "links": { "list": "https://travel.gc.ca/travelling/advisories" }, "home": "ca", "territories": [],
  "records": [
    { "title": "Israel and Palestine", "level": 3, "updated": "2026-09-24", "url": "https://…",
      "change": "Health – editorial change", "minorUpdate": true, "regional": true,
      "places": ["il", "gaza", "west-bank"] },
    { "title": "Somalia", "level": 4, "updated": "2026-05-21", "places": ["so"], "covers": ["somaliland"],
      "levelChange": { "date": "2026-09-30", "from": 3, "to": 4 } } ] }
```

- `places` lists the record's own places. If there are several, each is shown as covered by the record.
- `covers` lists places without an advisory of their own that fall under this one.
- `noteKey` points to a translated note, for records without places.

## The site

- **`main.js`** is the composition root.
  - It loads the manifest, picks a locale (saved choice, then browser languages, then the default), and loads messages, places and map geometry.
  - It creates the active dataset from `datasets/registry.js`, and creates the `WorldMap` with the dataset's `style` function.
  - It wires hover and selection *targets* to the details card, tooltip, feed and search.
- **`map/world-map.js`** is a generic map. `style(placeId)` returns `{ cls, muted, dim, dot, pulse }`, and the map draws fills, faded places, dots for tiny places and pulses. It also handles zoom, pan and click tolerance. Dataset-specific code never runs inside it.
- **Datasets** implement the interface documented in `datasets/registry.js`:
  - `load`, plus `providers`, `provider` and `setProvider`;
  - `style`, `details`, `tooltip` and `legend`;
  - `renderSettings`, `renderFeed`, `feedTarget` and `feedKeyFor`;
  - `searchEntries`, `header` and `footer`.

  Each dataset keeps its settings under its own namespace in the saved settings.
- **i18n** (`core/i18n.js`):
  - `t(key, params)` supports `{placeholders}` and plural forms (`{ "one": …, "other": … }`), and falls back to English.
  - Dates and ages use `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat`.
  - Place names come from the locale's `places.<id>` override if present, else the curated English name for English, else `Intl.DisplayNames` from the ISO code.
  - Text in `index.html` is marked with `data-i18n` and `data-i18n-<attr>`.
- **Safety:** all text from sources is escaped (`esc`), and links from data must be `http(s)` (`safeUrl`).

## How to…

### Add a provider (another government)
1. **Fetcher:** write `scripts/providers/<id>/index.mjs`. It exports `{ id, dataset, source, minorChange: [regex], fetch({ log, previous, today }) → { entries, stats } }`, with the pure parsing in `parse.mjs`. Entries are `{ name, level, updated: 'YYYY-MM-DD', url?, change?, regional? }`. Every request goes through `log.request()`.
2. **Registry:** add the module to `scripts/providers/index.mjs`.
3. **Config:** add `config/providers/<id>.json`. It sets `home` and `territories` (place IDs), `links.list`, `flag` (an ISO code, with the file `site/assets/flags/<flag>.svg`), `coveredBy`, `aliases` and `listOnly`.
4. **Dataset:** list the provider in `config/datasets/<dataset>.json`.
5. **Translations:** add `datasets.<dataset>.providers.<id>` (name, short, agency, levels, notes) to **every** locale.
6. **Workflow:** add a `node scripts/fetch.mjs <id>` step to `.github/workflows/update-advisories.yml`, with `continue-on-error` and an `id`. Include it in the `last-run.txt` and failure conditions.
7. **Fetch and build:**
   - run `node scripts/fetch.mjs <id>`, then `npm run build`;
   - the build lists every title it can't place, so add those to `aliases`;
   - add a real-response fixture and unit tests for `parse.mjs`.

### Add a dataset (e.g. flights) and a dataset menu
1. **Scale:** decide the dataset's value scale. It may not be levels 1–4. Colour classes are the dataset's choice; add CSS tokens for them.
2. **Pipeline:** add `config/datasets/<id>.json` and its providers, as above. If the published record shape differs, add a builder next to `buildProvider` and dispatch on the dataset in `buildSite`. The manifest already lists datasets.
3. **Site:** create `site/js/datasets/<id>/` implementing the interface (`logic.js` pure, `index.js` views), and register it in `datasets/registry.js`.
4. **Menu:** add a dataset menu to `index.html` and `main.js`. `settings.get('dataset')` already selects the active one. On change, save it and re-create the dataset, most simply by reloading.
5. **Translations** under `datasets.<id>.*`, and data and browser tests.

### Add a language
1. **Messages:** copy `site/i18n/en.json` to `site/i18n/<code>.json` and translate every value. Keep the keys. `meta.name` is shown in the picker, and `meta.dir` is `rtl` for right-to-left languages.
2. **Place names:** optionally add `places.<id>` overrides where the browser's name isn't right.
3. **Rebuild:** run `npm run build`. The manifest picks up the new locale, and the language picker appears automatically once there are two or more.
4. **Test:** `npm test`. It fails if any key is missing or extra compared with English.

### Change the map or places
- **Registry:** `config/places.json` is generated once by `npm run places:generate` from the base map, `site/js/map/splits.js` and the point list in the generator. Regenerate only when those change, and **review the diff: IDs must stay stable**, because config, history and data refer to them.
- **Splits:** a new split shape needs a rule in `splits.js`. The data test checks that every split shape exists in the registry.

## Moving to a database

The published and pipeline files are already shaped like tables, keyed by stable IDs:

| File today | Table |
|---|---|
| `config/places.json` | `places(id PK, name, iso2, shape, point)` |
| translations of place names | `place_names(place_id, locale, name)` (optional; Intl covers most) |
| `config/datasets/*.json` | `datasets(id PK, scale, recent_windows, default_recent_window)` |
| `config/providers/*.json` | `providers(id PK, dataset_id, flag, home_place_id, list_url)` plus `provider_aliases(provider_id, title, place_id)`, `provider_territories`, `provider_covered_by(provider_id, place_id, title)` |
| `data/snapshots/…` | `snapshots(provider_id, fetched_at, payload)`, or keep only records |
| `site/data/<dataset>/<provider>.json` | `records(provider_id, title, level, updated, url, change, minor_update, regional)` plus `record_places(record_id, place_id, role: own/covers)` |
| `data/history/*.json` | `level_history(provider_id, title, date, level)` |
| `logs/fetch/*.jsonl` | `fetch_runs(time, provider_id, run, result, duration_ms, calls jsonb, stats jsonb)` |

Steps:
1. **Pipeline:** implement a `DbStore` with the same methods as `FileStore` (`places`, `dataset`, `provider`, `snapshot`/`saveSnapshot`, `history`/`saveHistory`, `publish`) and pass it to the scripts.
2. **API:** serve the same JSON shapes (`manifest`, `places`, `<dataset>/<provider>`) from an API, then point `createDataClient({ base })` at it. The site needs no other change.
3. **Tests:** keep the data tests. They compare what is served against a fresh build.

## Testing and deployment

See the README's **Tests** section. In short:
- `npm test` runs the unit and data tests;
- `npm run test:e2e` runs the browser tests;
- `.github/workflows/deploy.yml` runs both and deploys `site/` only if they pass.

The daily update (`update-advisories.yml`) fetches at a random time, builds, commits, and then calls the same test-and-deploy workflow.
