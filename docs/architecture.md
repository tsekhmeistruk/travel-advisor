# Architecture

This project is a map of the world that shows **data about places**: wars and armed conflicts (UCDP), tensions in the news (GDELT), official travel-advisory levels from five governments, disaster alerts (GDACS) and outbreak notices (WHO). The code is built so that more **providers** (other governments), other **datasets** (flights, statistics), more **languages** and a **database** can be added without restructuring.

## Principles

- **Data is facts, text is translations.** Published data holds IDs, levels, dates and the level history. All interface text, including each provider's level wording, lives in `site/i18n/<locale>.json`.
- **Everything refers to places by ID.** The place registry (`config/places.json`) is shared by every dataset.
- **The map is generic.** It draws places and asks the active dataset how each one should look. It knows nothing about advisories.
- **Pure logic, thin I/O.** Parsing, merging, level history and view rules are pure functions with unit tests. Scripts and UI glue only read, write and render.
- **One storage boundary.** The pipeline touches files only through `scripts/lib/store.mjs`, and the site loads data only through `site/js/core/data-client.js`. These are the two seams where a database or API plugs in.
- **Nothing deploys untested.** Every deploy runs the unit, data and browser tests first.

## Concepts

| Concept | What it is | Where |
|---|---|---|
| **Place** | Something drawn on the map: a country, territory or split region. It has a stable `id` (`fr`, `gaza`), an English `name`, optional ISO codes (`iso2`, `iso3`), and a map `shape` or a `point` | `config/places.json`, published as `site/data/places.json` |
| **Dataset** | A kind of data shown on the map, e.g. `travel-advisories`. It defines its scale, its providers and its settings | `config/datasets/<id>.json`, plus a site module in `site/js/datasets/<id>/` |
| **Provider** | One source within a dataset, e.g. `us`, `ca` or `nl` | `config/providers/<id>.json` and `scripts/providers/<id>/` |
| **Record** | One item from a provider, e.g. one advisory. It refers to its places by ID | `site/data/<dataset>/<provider>.json` |
| **Target** | What the user is pointing at: `{ placeId }` or `{ recordKey }` (a record with no place, e.g. "French West Indies") | `site/js/main.js` |
| **Locale** | A language file | `site/i18n/<code>.json` |

## Repository layout

```
config/                        hand-edited configuration (future: reference tables)
  places.json                  place registry (generated once by scripts/tools/generate-places.mjs, then reviewed)
  datasets/<id>.json           dataset definition: scale, providers, settings options
  providers/<id>.json          provider mapping: home, territories, coveredBy, aliases, codes, list-only entries
  categories.json              risk categories (travel, conflict, disaster, wildfire, …) and their 1–4 scale
  sources/<id>.json            a risk source: type, authority, level map, event types and categories, codes
                               (ucdp: country names, deaths bands, the war threshold, trends, quiet;
                               wikipedia: conflict key -> article; usgs, eonet: markersOnly)
  schedule.json                how often each provider and source is fetched
data/                          pipeline state (future: database tables)
  snapshots/<dataset>/<p>.json latest fetch of each provider
  history/<dataset>.json       level history per provider and record
  events/<source>.json         a risk source's current events (and those ended in the last 90 days)
  counts/<source>.json         a counts source's daily counts per place and series (GDELT news reports)
  counts/<source>-pairs.json   its daily counts per pair of countries (GDELT military news: tensions)
  conflict/<source>/<v>.json   a conflict source's monthly versions, written once (UCDP: one event per line, format 2)
  context/<source>.json        a context source's articles (Wikipedia: summaries, infobox sides, short names)
  archive/events/<source>/<yyyy>.jsonl   events that left the current file
  signals/current.json         confirmed risk signals per category and place, with pending falls
  changes/<yyyy>.jsonl         the risk change log (append-only)
  sources-state.json           last attempt and last success of every fetch
logs/fetch/<yyyy>/<yyyy-mm>.jsonl   one line per fetch run (see logs/README.md)
scripts/                       the data pipeline (Node 22, no dependencies)
  fetch.mjs <id>               fetch one provider into its snapshot, or one source into its events
  due.mjs                      which providers and sources are due (for the hourly workflow)
  build.mjs                    build site/data from config + snapshots + history + events
  serve.mjs                    local static server for site/
  log-summary.mjs              fetch log as a table
  lib/                         pure logic: build.mjs (matching, level history), merge.mjs (merge with the previous
                               snapshot, level-change confirmation), risk.mjs (signals, changes, health),
                               events.mjs (event upsert), schedule.mjs (due check), text.mjs, conflict.mjs (UCDP
                               figures, war count, bands, trends, sides, dots), wars.mjs (the wars' context from
                               Wikipedia, matched to UCDP's sides), counts.mjs and anomaly.mjs (news activity);
                               I/O boundary: store.mjs; logging: fetch-log.mjs, log-summary.mjs (Fetch results table)
  providers/<id>/              index.mjs (network), parse.mjs (pure parsing)
  tools/generate-places.mjs    regenerates config/places.json
  tools/screenshots.mjs        npm run shots: screenshots of any view (serves site/ itself)
  tools/live-check.mjs         npm run live-check: every mode on the live site, console errors
  tools/merge-bot-data.mjs     npm run merge-bot-data: merge the bot's data commits, rebuild
  tools/tick.mjs               npm run tick: tick a plan checklist in docs/plans/
site/                          the published website: deployed as-is
  index.html, css/, vendor/ (d3, topojson), assets/flags/
  i18n/<locale>.json           all interface text
  data/                        published data: manifest.json, places.json, <dataset>/<provider>.json, risk/, geo/
  js/
    main.js                    composition root: loads data, creates the dataset and map, wires the panel
    core/                      i18n, settings, data client, URL state, DOM helpers (pure except dom.js)
    map/                       world-map.js (generic map), splits.js (map geometry fixes)
    datasets/                  registry.js (modes, dataset interface), travel-advisories/, risk/ and wars/ (logic.js pure, index.js views)
    ui/                        search, mode switch, provider switch, theme, language picker, tooltip
tests/
  unit/pipeline, unit/site     pure logic, with real-response fixtures in tests/fixtures/
  data/                        published data vs a fresh build, config and translation checks
  e2e/                         headless browser over the served site (real data plus injected level changes)
```

## Data flow

```
                ┌───────────────┐    ┌────────────────────────┐    ┌──────────────────────────┐
 provider site ─► fetch.mjs <p> ├───►│ data/snapshots/…/p.json│──┐ │ build.mjs                │
                └───────────────┘    └────────────────────────┘  ├►│  resolve names → places  ├──► site/data/*.json ──► browser
            config/places.json, datasets/*, providers/* ─────────┤ │                          │
            data/history/<dataset>.json ◄──────────────────────────┤  track level history     │
                                                                   └──────────────────────────┘
```

1. **Fetch** (`scripts/fetch.mjs <provider>`) loads the provider module, gives it the previous snapshot, and saves the new one. Each provider decides how to fetch and how to merge. The U.S. and the Netherlands merge through `lib/merge.mjs`: stale copies are ignored, a level change applies only once a fetch on a later day confirms it, and advisories missing for up to 7 days are kept. Canada combines its feed and live table, and applies its official levels at once. Every request is logged.
2. **Build** (`scripts/build.mjs` → `buildSite()` in `lib/build.mjs`) does two things:
   - matches each record to places: the provider's `listOnly` entries and title `aliases` first, then its code aliases (`codes`, for codes that aren't one place, e.g. `PSE`), then an automatic match on the **ISO code** (alpha-2 or alpha-3), then on the place's name or map shape, ignoring accents and punctuation;
   - updates the level history (`trackHistory()`), which is the **only** source of "what changed": a change is a different level than the last snapshot's, on a later day. Each record gets its last three `levelChanges` and `trackedSince`, the first snapshot that had it. A log may begin with changes a source announced before tracking began (`source: "note"`; the U.S. ones were seeded once from its change notes), whose `from` is `null` when only the direction was given.

   It **fails** if anything can't be placed.
3. **Risk layer** (`buildRisk()` in `lib/risk.mjs`, see below) turns the advisories and the risk sources' events into signals and changes.
4. **Publish:** the build writes the files the site loads. The data test checks that they equal a fresh build, and that the signal state and change log already include the data.

## The risk layer

The product is growing from a travel-advisory map into a risk monitor: several sources, one level per place and **category**. Three things are kept apart, in code and in the published files:

| Layer | What it is | Example | Where |
|---|---|---|---|
| **Source fact** | What a source said, in its own terms (the *native* value) | GDACS: Orange cyclone alert over Mexico; U.S.: Level 3 | `data/events/`, advisory files |
| **Signal** | Our level 1–4 (Normal, Elevated, High, Critical) per place and category, with the facts that set it (`basis`) | Mexico, `disaster`: 3 | `site/data/risk/current.json` |
| **Change** | A confirmed move of a signal, a new major event, or an advisory level change | Mexico `disaster` 1 → 3 | `data/changes/`, `site/data/risk/changes.json` |

"No data" is never a level: an uncovered place, or a source that is down, has no signal rather than Normal.

- **Travel** is the level that at least two of the governments covering a place give, or the only one's where one covers it (`travelLevel()`), so one government alone, or one misread advisory, doesn't set it. The signal keeps each government's own level (`natives`), how many give this very level (`agree`), and a stricter government (`strictest: { level, by }`), which the card names by its flag. (Until Oct 2, 2026 it was the highest of them: one government alone set the level in 43 places.) Its changes come from the advisory level history, as before, so changing this rule records no change.
- **Conflict** comes from UCDP's monthly candidate events (`lib/conflict.mjs`, source kind `conflict`): a place's deaths in organized violence over 12 months (state-based, non-state and one-sided, where they happened) give its level through `bands` (25 Elevated, 100 High, 1,000 Critical). Events are placed by UCDP's country names (`countries`), Israel's by region first (Gaza Strip, West Bank). A later version wins for an event it repeats. The figures (`risk/conflict.json`): the war count per month (state-based conflicts, a government on one side, with 1,000+ deaths in the 12 months to that month), each place's months, deaths by type, trend (`up`: the last 3 months ≥ 1.5× the 3 before and ≥ 150 deaths; `down`: ≤ 0.5× and the 3 before ≥ 150), the conflicts fought there and those it is a party to (the governments on its sides; "XXX475" is an unnamed group fighting the government of country 475). Levels change only when a new month comes out (`confirmFallMinutes` 0); a source in `error` keeps its state and publishes no levels, but its figures stay.
  - **Who fights whom:** each stored version (format 2; an older one is downloaded again by the fetcher, and the build refuses it) keeps every event's dyad (side ids and an actor table), civilian deaths and point. A listed conflict publishes its `sides` (`a`: the government and any government fighting beside it; `b`: every opponent, each with the deaths in the events it fought, a government mapped to its place; "XXX475" on side A is Nigeria's government, on side B an unidentified group), its 12 `months`, `civilians12`, `first` month and `trend`. Top level: `new` (armed conflicts first seen in the 12 months, with data before) and `quiet` (100+ deaths in the 12 months before the last 3, none since). `risk/conflict-events.json` has the latest month's events with a point (not UCDP's country-wide rows, precision 6–7), for dots.
- **Context** (`kind: "context"`, today Wikipedia, weekly): `lib/wars.mjs` matches each article's infobox sides to UCDP's (by the countries and groups they share; Wikipedia may list them the other way round, or add a third side), keeps only names that are countries in the place registry (allies `with` a side, and `backers`), and spells out UCDP's short names from the infobox links ("RSF" → "Rapid Support Forces"). Published as `risk/wars.json`; never a level or a change. A war without an article only warns.
- **Markers-only event sources** (`markersOnly` in the config: USGS earthquakes M5+, NASA EONET volcanoes) add map markers, never a level or a change (each event source otherwise sets its whole category's levels). Their events are `marker: true`; one that GDACS also reports (`duplicates`: the same type within so many km, and hours for a quake) is shown once, as GDACS's.
- **Event categories** (`disaster`, `wildfire` from GDACS; `health` from WHO Disease Outbreak News, a notice being Elevated for 30 days) come from a source's active events: `config/sources/<id>.json` maps each native value to a level (GDACS: Green 1, Orange 3, Red 4), caps some types (drought at 2), and gives each type a tail after its end (earthquake 7 days). An event on no place (offshore) only warns.
- **Confirmation:** a rise is recorded at once. A fall is recorded only when a fetch at least `confirmFallMinutes` later still shows it; until then the signal keeps its level with a `pending` fall. The first run of a category sets a baseline without changes, and events of a source's first fetch aren't "new".
- **Idempotent:** change ids are built from the place, category and fetch time (or event id and revision time), and the build's "now" is the newest fetch time in its inputs, so building the same data twice changes nothing.
- **Health:** each provider and source is `healthy` (last success within 1.5 × its interval), `delayed`, or `error` (past its stale limit: `staleAfterHours`, or 7 days for advisories). A source in `error` publishes no levels and keeps its last state.

### Unusual activity (news reports)

A **counts source** (`kind: "counts"`, today GDELT) never sets a level. GDELT codes news reports into events by machine; the pipeline counts, per place and day, protest reports (CAMEO root 14) and violence reports (18–20), by where they happened (FIPS codes, mapped to places in `config/sources/gdelt.json`), in `data/counts/gdelt.json` (`lib/counts.mjs`: one number per day, gaps left out of windows).

`lib/anomaly.mjs` compares each place's last 7 days with its own previous 84:

- **Expected** is the baseline's count scaled to one week. **Chance** is P(X ≥ count) for a Poisson count with that mean (a normal approximation above a mean of 100).
- **Above normal:** count ≥ 5, at least 3 more than expected, twice as many, p < 0.01. **Far above normal:** count ≥ 10, four times as many, p < 0.001.
- **Hysteresis:** a status holds while the ratio stays at least half of the one that entered it and p ≤ 0.05.
- **Percentages** are shown only from an expected count of 2, so 0 → 1 never reads "+100%".
- **Learning:** it needs about 3/4 of the baseline (a backfill of 98 days is fetched once).

**Tensions** use the same files and rules on pairs of countries: military events between two different countries' actors (CAMEO 15 force posture, 19 and 20 fighting, 138 threats of military force), counted per pair of the source's country codes in `data/counts/gdelt-pairs.json` (its own days, so it backfills on its own; pairs below `pairs.minTotal` reports are pruned), judged by `tensionSignals()` with a stricter `pairs.anomaly` rule (20+ reports, 10+ above expected, 3×). Codes are placed by `pairs.actors` (PSE: Gaza and the West Bank) or ISO alpha-3; regions (AFR, EUR, WST) are left out. Published as `activity.gdelt.tensions` and as each place's `tensions`; never a level, a change or a pulse.

Statuses above normal are published as `activity` in `risk/current.json`, each place's figures in its place file, and a change of status is a change of kind `anomaly` (listed, never pulsed). The card shows them in its "coming later" slot ("News: Protest reports far above normal (GDELT)"), and the country view as figures against the normal.

The site shows the risk layer through **map modes**, **event markers** and a **country view** (see below).

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
      "regional": true, "places": ["il", "gaza", "west-bank"], "trackedSince": "2026-09-26" },
    { "title": "Somalia", "level": 4, "updated": "2026-05-21", "places": ["so"], "covers": ["somaliland"],
      "levelChanges": [{ "date": "2026-09-30", "from": 3, "to": 4, "up": true },
                       { "date": "2026-04-28", "from": null, "to": 3, "up": true }],
      "trackedSince": "2026-09-26" } ] }
```

- `places` lists the record's own places. If there are several, each is shown as covered by the record.
- `covers` lists places without an advisory of their own that fall under this one.
- `noteKey` points to a translated note, for records without places.
- `updated` is the source's own date for its latest edit. It is shown, but a pulse means only a level change (`levelChanges`, newest first).

The manifest also has `risk: { asOf, current, changes, events, health, conflict, conflictEvents, wars, places }` (`RISK_FILES` in `scripts/build.mjs`), pointing at the risk files (`places` is a folder, `risk/places/`):

```json
// risk/current.json: event categories list only places above Normal; `default` is the level of every
// other covered place (null: no data)
{ "asOf": "2026-09-27T16:25:57.372Z", "scale": { "type": "levels", "values": [1,2,3,4] },
  "categories": { "travel": { "sources": ["us","ca","nl"], "default": null },
                  "disaster": { "sources": ["gdacs"], "default": 1, "status": "healthy", "at": "2026-09-27T16:25:57.372Z" } },
  "sources": { "gdacs": { "url": "https://www.gdacs.org/", "terms": "https://…" }, "us": { "url": "https://travel.state.gov/…" } },
  "places": { "mx": { "travel": { "level": 2, "natives": { "us": 2, "ca": 2, "nl": 2 }, "agree": 3 },
                      "disaster": { "level": 3, "since": "…", "from": 1, "basis": ["gdacs:TC:1001325"] } } } }

// risk/changes.json: the last 90 days, newest first. kind: level | event | advisory
{ "asOf": "…", "windowDays": 90, "changes": [
  { "id": "mx:disaster:…", "at": "…", "kind": "level", "category": "disaster", "placeId": "mx", "from": 1, "to": 3, "up": true, "basis": ["gdacs:TC:1001325"], "sources": ["gdacs"] },
  { "id": "advisory:us:Saint Lucia:2026-07-10", "at": "2026-07-10", "kind": "advisory", "category": "travel", "source": "us", "placeIds": ["lc"], "from": 1, "to": 2, "up": true, "seeded": true } ] }

// risk/events.json: active events, our level beside the source's
{ "asOf": "…", "events": [{ "id": "gdacs:TC:1001325", "source": "gdacs", "type": "cyclone", "category": "disaster", "level": 3,
  "native": { "scheme": "gdacs-alert", "value": "Orange" }, "name": "…", "placeIds": ["mx"], "point": { "lon": -105.1, "lat": 18.5 },
  "startedAt": "…", "toDate": "…", "current": true, "url": "https://www.gdacs.org/report.aspx?…" }] }

// risk/places/<placeId>.json: one per place, for the country view; no as-of time inside, so a file
// changes only when its content does
{ "placeId": "mx",
  "advisories": { "us": { "level": 2, "title": "Mexico", "updated": "2026-05-29", "url": "https://…", "own": true } },
  "events": ["gdacs:TC:1001325"],
  "changes": [ /* the place's changes of the last 365 days, newest first, as in changes.json */ ] }

// risk/current.json, beside the levels: unusual activity of counts sources (never a level)
"activity": { "gdelt": { "through": "2026-09-27", "learning": false, "windowDays": 7, "baselineDays": 84,
  "places": { "et": { "violence": { "status": "far", "count": 640, "expected": 56.5 } } } } }
// a change of status in risk/changes.json
{ "id": "et:violence:2026-09-27", "at": "2026-09-27", "kind": "anomaly", "category": "security", "placeId": "et",
  "series": "violence", "source": "gdelt", "from": "normal", "to": "far", "up": true, "count": 640, "expected": 56.5 }

// risk/conflict.json: a conflict source's figures (lib/conflict.mjs)
{ "asOf": "…", "source": "ucdp", "version": "26.0.8", "through": "2026-08", "preliminary": true,
  "links": { "home": "https://ucdp.uu.se/", "conflict": "https://ucdp.uu.se/conflict/" },
  "windowMonths": 12, "bands": [1000, 100, 25], "warDeaths": 1000,
  "series": { "months": ["2024-09", …], "wars": [null, …, 16], "armedConflicts": [null, …, 72], "deaths": [11612, …, 11118] },
  "conflicts": { "1:309": { "name": "Sudan: Government", "deaths12": 5099, "civilians12": 2232, "last": 204, "months": [483, …, 204],
                            "first": "2024-01", "trend": "down", "war": true, "places": ["sd", "td", "et"], "parties": ["sd"],
                            "sides": { "a": [{ "name": "Government of Sudan", "place": "sd", "deaths": 5099 }],
                                       "b": [{ "name": "SFA", "deaths": 4813 }, { "name": "RSF", "deaths": 286 }] } } },
  "new": ["1:16905", …], "quiet": [{ "key": "1:299", "name": "Syria: Government", "deaths": 2238, "lastDeaths": "2025-07", "parties": ["sy"] }],
  "places": { "ua": { "deaths12": 97381, "months": [9298, …, 5648], "byType": { "state": 97336, "nonState": 0, "oneSided": 45 },
                      "trend": null, "conflicts": ["1:13243"], "partyTo": ["1:13243"] } } }
// place files add "conflict" (the place's figures, conflicts spelled out) and "tensions"

// risk/conflict-events.json: the latest month's events with a point, for dots
{ "through": "2026-08", "actors": { "112": "Government of Sudan", "8635": "RSF" }, "conflicts": { "1:309": "Sudan: Government" },
  "events": [[13.63, 25.35, 27, "2026-08-01", "1:309", 112, 8635, "sd", "North Darfur state"]] }   // lat, lon, deaths, date, key, side A, side B, place, region

// risk/wars.json: the context of each war (lib/wars.mjs, from Wikipedia)
{ "asOf": "…", "source": "wikipedia", "licence": "CC BY-SA 4.0", "conflicts": { "1:13243": {
  "title": "Russo-Ukrainian war (2022–present)", "url": "https://en.wikipedia.org/wiki/…", "extract": "On 24 February 2022, …",
  "start": "2022-02", "map": "https://en.wikipedia.org/wiki/File:…svg", "revised": "…",
  "sides": { "a": { "with": ["by", "kp"], "backers": [] }, "b": { "with": [], "backers": [] } }, "names": {} } } }

// risk/current.json, beside the news activity: tensions (never a level)
"activity": { "gdelt": { …, "tensions": { "through": "2026-10-01", "learning": false, "windowDays": 7, "baselineDays": 84,
  "pairs": { "AFG|PAK": { "status": "above", "count": 209, "expected": 56.9, "sides": [["af"], ["pk"]] } } } } }

// risk/health.json
{ "asOf": "…", "sources": { "gdacs": { "status": "healthy", "lastSuccess": "…", "lastAttempt": "…", "consecutiveFailures": 0, "records": 13 } } }
```

## The site

- **`main.js`** is the composition root.
  - It loads the manifest, picks a locale (saved choice, then browser languages, then the default), and loads messages, places and map geometry.
  - It picks the **mode** (the URL hash first, then the saved choice, then Wars; `RENAMED` maps old ids), creates that mode's dataset from `MODES` in `datasets/registry.js`, and creates the `WorldMap` with the dataset's `style` function.
  - It wires hover and selection *targets* to the details card, tooltip, feed and search.
  - **On the map**, top centre: the mode switch (`ui/controls.js`), and in Travel the provider switch below it (`.map-top`); on phones the mode switch is a full-width row that scrolls if it must, with the zoom controls and provider switch below it. The map keeps the mode row clear (`topInset` of `WorldMap`).
  - **Panel order:** header (one line, with an ellipsis and the whole text in its title; the data age: "Updated 2 hours ago" in the risk modes, "Data as of Oct 1, 2026" in Travel; a delayed source comes first, "GDACS delayed · Updated …"; stale data is flagged, see `stale()`), search, the details card, the feed (in Wars: the Wars list), then the **Filters** (a `<details>`, collapsed by default, its state saved as `filtersOpen`; hidden in Wars, `settingsHidden`) and the footer: one line, the mode's own sources, linked, and "How it works" (opens the help).
  - The legend ends with an ⓘ button that opens **How levels work** (`<dialog id="help">` in `index.html`, text in `help.*`): the scale, what sets each level, confirmation, and that news activity never sets a level. Escape or the backdrop closes it.
  - Switching modes loads the new dataset first, then swaps it in place: no reload, and the map, zoom and selected place stay.
  - On user actions it writes the mode and the selected place or war to the URL (`#mode=disaster&place=mx`, `#mode=wars&war=1-309`, `core/url-state.js`), so a view can be linked. A new hash (a link, back and forward) switches to it.
- **Modes** (`MODES` in `datasets/registry.js`), each a dataset, offered only when the manifest has their data:

  | Mode | Colours places by | Module |
  |---|---|---|
  | Wars (the default) | the `conflict` category: deaths in armed violence over 12 months (UCDP) | `datasets/wars/`, built on the risk mode |
  | Disasters | the `disaster` and `wildfire` categories (GDACS), the higher of the two | `datasets/risk/` (`view: 'category'`, `categories`) |
  | Travel | one government's advisory level, with the provider switch | `datasets/travel-advisories/` |
  | All | the highest level of any risk category | `datasets/risk/` (`view: 'highest'`, id `highest`) |

  The Wildfires and Changes modes were merged into Disasters and removed (Oct 2026): `RENAMED` in `registry.js` sends their old links and saved modes to Disasters and Wars. The **Wars** mode is the risk mode on the `conflict` category with its own cards: the overview (the war count and its sparkline, the latest month's deaths against the month before, escalating and calming places as buttons, and up to three Tensions), and a place card (12 monthly bars, the conflicts fought there or that it is a party to, violence with no government as a side, a link to UCDP); its header names the data month. Since Oct 2026 Wars also shows **who fights whom**: a **Wars list** replaces the change feed (one row per conflict: "Sudan vs SFA, RSF · 5,099", its title and trend; the first 8, then all and those gone quiet), the overview has "New in 12 months" chips, and a **war card** (target `{ warKey }`, from a row, a chip, a conflict on a place card, a dot, the search or `#…&war=`) shows side A over side B in the map's colours (UCDP's fighters, Wikipedia's allied and backing countries), the deaths, trend and months, and Wikipedia's summary, credited. A hovered or selected war colours the map (`focus(target)`, `warFocus()`): side A blue, side B purple (`--side-a`, `--side-b`, Okabe–Ito), allies lighter, where it is fought in grey (`--fought`), the rest muted; the map zooms to where it is fought. The latest month's deaths are one dot per country, at its centre, sized by the count (`countryDots()`, `points()`; smaller on narrow maps; a click opens its deadliest war). The country view of every mode has an "Armed violence (UCDP)" section after the categories, naming both sides of each conflict. The risk card keeps four rows: Travel, Conflict, Disaster (with wildfires, `cardRows()`), Health.

  The risk modes share one factory (`createRiskMode`) and one settings namespace (`risk`: levels, window 24 h / 7 / 30 / 90 days, direction, fade). Their card lists every category with its level and what set it: "2 of 3 governments", or the GDACS alert. Their overview card shows the three latest changes (a click selects the place). Their feed lists level changes, advisory changes and new or changed alerts, one row per place and category (`groupFeed()`: the newest, "and 3 earlier"), the first 8 until "Show all". **News activity is not a change** (`isNews()` in `risk/logic.js`): the published anomaly records are left out of the feed, "Latest changes", tooltips, the card and country-view histories, and the fading ("Fade places without a recent change"). It is shown as it is now: on the card's news line ("News: protest reports far above normal (GDELT)", or "no unusual activity") and in the country view, with the place's tensions. (A front-page list of it was removed in Oct 2026: it led with noise.) Travel's overview shows its latest level changes too. An empty feed is its heading and 0; the overview card says so and offers "Show 90 days" (`showWindow(days)`). The header says "Updated 2 hours ago", and flags data over 12 hours old (`isStale()` in `risk/logic.js`): GitHub drops scheduled runs. A pulse still means only a level change. A place with no data is drawn grey and never pulses.
- **Event markers:** a mode may return `markers()` (`[{ id, lon, lat, kind, level }]`), which the map draws with `setMarkers()`: a coloured disc per event, with an icon per kind (earthquake, cyclone, flood, volcano, drought, fire). Markers whose screen positions share a 28px cell become one cluster with a count and the highest level (`map/clusters.js`, pure); clicking a cluster zooms in to split it, and at the closest zoom selects its first event. A selected marker is the target `{ eventId, placeId }`: the card shows the event (the source's facts, our level beside them, the places it affects, a link to the source), and its place is outlined. Disasters marks its categories' events (wildfires included, and the markers-only USGS quakes and EONET volcanoes, whose cards show the magnitude or "Active" without a level of ours; the overview counts them); All marks only Orange and Red ones; Wars and Travel none.
- **Country view:** "Country details" on the risk card (and on the Travel card, which borrows a risk mode's viewer, loaded when first opened) opens a full panel view in place of the card, settings and feed (`#…&view=country` in the URL; Back or Escape closes it, selecting another country follows it). It shows every category, the active alerts (click: the event card), each government's advisory in its own words with a link, and the place's changes over 7, 30, 90 days or a year. It loads `risk/places/<id>.json` only when opened. **Share** (beside Back) gives the link to the view (`#mode=…&place=…&view=country`): the share sheet on a touch screen (`navigator.share`), otherwise the link is copied and a toast says "Link copied" (`#toast`, fixed to the viewport).
- **Loading:** `#app` is `aria-busy` until `main()` settles (drawn, or the error box shown); meanwhile CSS draws a pulsing outline of the world and of the card. **`/`** focuses the search (not while typing in a field).
- **Search** (`ui/search.js`) finds what the dataset's `searchEntries()` lists: every place, and in the risk modes also the active alerts by name (the mode's category only, in a category mode; Green forest fires are left out, as each repeats a generic name). The prompt comes from `searchPlaceholder()` ("Find a country or alert"). Choosing an alert shows its card and zooms to its marker (`WorldMap.zoomToMarker()`), or to its place when the mode shows no marker.
- **Phone sheet:** on screens up to 760px (`matchMedia` in `main.js`), a tap on a country or marker shows the dataset's `tooltip()` (or `markerTooltip()`) in a sheet over the bottom of the map, since the card is below the map there. Details scrolls to the card (or the open panel view); ×, the ocean, or a choice in the panel closes it. Desktop never shows it.
- **Countries list:** "All countries →" on the overview card (and the list button in the panel header) opens every place with its level in the current mode (`#…&view=list`; Travel borrows the highest levels, like the country view). `countryRows()` and `sortRows()` in `risk/logic.js` (pure) give the rows and the three orders: level, last level change, name (saved as `listSort`). The filter reuses the search's `rankMatches()`. A row (or a country clicked on the map) opens the country view; its Back, or Escape, returns to the list with its filter kept. `main.js` keeps one `panelView` (`'country'`, `'list'` or none).
- **Data freshness:** `core/data-client.js` revalidates the manifest on every load and asks for each data file with its as-of time (`?v=…`), because GitHub Pages lets browsers cache files for minutes and the data changes hourly.
- **`map/world-map.js`** is a generic map. `style(placeId)` returns `{ cls, muted, dim, dot, pulse }`, and the map draws fills, faded places, dots for tiny places and pulses. `setPoints([{ id, lon, lat, r, dim }])` (or `placeId` for a place's centre) draws small circles (Wars' dots per country), with `onPointHover` and `onPointSelect`; `zoomToPlaces(ids)` fits several places, clamped to the pan limits (`zoom.transform` doesn't clamp by itself), so Russia doesn't push the world off screen. It also handles zoom, pan and click tolerance. A resize (the panel collapsing, a window or a phone turning) refits the world but keeps the view: the same centre at the same zoom. A resize to the same size does nothing, so a zoom started at load (a link to a place) isn't undone. **Zoomed in** (×2.5 or more) it names the places that have room (`labelFor(placeId)`, the locale's names), largest first and without overlaps, clear of the switches and the legend (`labelInsets()`): `placeLabels()` in `map/labels.js` (pure) picks them; the labels sit under the markers and let clicks through. `pin(lon, lat)` gives a `<g>` kept at a point and a fixed pixel size (`pinScale`), under everything and never hit by the pointer; `focusPoint({ placeIds, markerId })` says where a selection is. **The capybara** (`map/mascot.js`) is such a pin, north of Toronto: it looks east, towards the selection (`main.js` calls `lookAt()`), and at the visitor after 15 seconds without a click or key (`map/gaze.js`, pure); it leaves the screen with Canada when the map zooms elsewhere. Dataset-specific code never runs inside it.
- **Datasets** implement the interface documented in `datasets/registry.js`:
  - `load`, plus `providers`, `provider` and `setProvider`;
  - `style`, `details`, `tooltip` and `legend`;
  - `renderSettings`, `renderFeed`, `showWindow`, `feedTarget` and `feedKeyFor`;
  - `searchEntries` (and optionally `searchPlaceholder`), `header`, `stale` and `footer`;
  - optionally (Wars): `focus(target)` (true when the map must repaint), `points()`, `pointTooltip(id)`, `pointTarget(id)`, `hasWar(key)`, `warPlaces(key)`, `warTooltip(key)` and `settingsHidden`.

  Each dataset keeps its settings under its own namespace in the saved settings.
- **i18n** (`core/i18n.js`):
  - `t(key, params)` supports `{placeholders}` and plural forms (`{ "one": …, "other": … }`), and falls back to English.
  - Dates and ages use `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat`.
  - Place names come from the locale's `places.<id>` override if present, else the curated English name for English, else `Intl.DisplayNames` from the ISO code.
  - Text in `index.html` is marked with `data-i18n` and `data-i18n-<attr>`.
- **Safety:** all text from sources is escaped (`esc`), and links from data must be `http(s)` (`safeUrl`).

## How to…

### Add a provider (another government)
1. **Fetcher:** write `scripts/providers/<id>/index.mjs`. It exports `{ id, dataset, source, fetch({ log, previous, today }) → { entries, stats } }`, with the pure parsing in `parse.mjs`. In `stats`, report level changes as `levelChangesConfirmed` (after confirmation) or `levelChanged` (applied at once), so the run table shows them. Entries are `{ name, level, updated: 'YYYY-MM-DD', url?, regional?, iso? }`. If levels come from an unreliable source, merge with `mergeWithPrevious()` (`lib/merge.mjs`) so a level change waits for a later day's confirmation. Every request goes through `log.request()`.
2. **Registry:** add the module to `scripts/providers/index.mjs`.
3. **Config:** add `config/providers/<id>.json`. It sets `home` and `territories` (place IDs), `links.list`, `flag` (an ISO code, with the file `site/assets/flags/<flag>.svg`), `coveredBy`, `aliases` (by title), `codes` (by source code, for codes that aren't one place) and `listOnly`.
4. **Dataset:** list the provider in `config/datasets/<dataset>.json`.
5. **Translations:** add `datasets.<dataset>.providers.<id>` (name, short, agency, levels, notes) to **every** locale.
6. **Schedule and workflow:** add `"<id>": { "every": "daily-slot" }` to `config/schedule.json`, and a `node scripts/fetch.mjs <id>` step to `.github/workflows/update.yml` with an `id`, `continue-on-error`, and `if: contains(steps.due.outputs.due, ',<id>,')`. Include it in the failure conditions.
7. **Fetch and build:**
   - run `node scripts/fetch.mjs <id>`, then `npm run build`;
   - the build lists every title it can't place, so add those to `aliases`;
   - add a real-response fixture and unit tests for `parse.mjs`, and fetcher tests in `providers.test.mjs`;
   - the browser tests read providers from the manifest, so the new one is tested at desktop and phone widths automatically.

### Add a risk source (events, e.g. GDACS; or monthly conflict data, e.g. UCDP)
1. **Fetcher:** write `scripts/providers/<id>/index.mjs`, exporting `{ id, kind: 'events', source, fetch({ log, previous, now, config }) → { events, expired, stats } }`, with the pure parsing in `parse.mjs`. Parse only the source's facts: keep its level as `native: { scheme, value }` and leave our level to the build. Leave out fields that change on every request, so the committed events file changes only when an event does. Merge with `mergeEvents()` (`lib/events.mjs`). Every request goes through `log.request()`.
2. **Registry:** add the module to `SOURCES` in `scripts/providers/index.mjs`.
3. **Config:** add `config/sources/<id>.json`: `name`, `type`, `authority`, `links.home` and `links.terms`, `staleAfterHours`, `confirmFallMinutes`, `lookbackDays`, `retainEndedDays`, the `scheme` and its `levels` map, `types` (each with `type`, `category`, `tailDays`, optional `maxLevel`), and `codes` for codes that aren't one place. Categories must exist in `config/categories.json`.
4. **Schedule and workflow:** `"<id>": { "everyMinutes": 60 }` in `config/schedule.json`, and a step as for providers.
5. **Tests:** a real-response fixture, parser tests, fetcher tests in `providers.test.mjs`. `project.test.mjs` checks the wiring.
6. **A conflict source** (`kind: "conflict"`, like UCDP) instead stores each version it fetches (`saveConflictVersion`) and gives `config.category`, `countries`, `bands`, `war`, `armedConflict`, `trend`, `quiet` and `windowMonths`; `lib/conflict.mjs` turns the versions into levels, `risk/conflict.json` and `risk/conflict-events.json`. A change of the stored format bumps `FORMAT` (`parse.mjs`) and `STORED_FORMAT` (`lib/conflict.mjs`): the fetcher then downloads the stored versions again, `maxVersionsPerRun` at a time.
7. **A markers-only source** (`markersOnly: true`, like USGS and EONET) is an events source whose events are only markers; give it `duplicates: { km, hours? }` so an event GDACS reports is shown once.
8. **A context source** (`kind: "context"`, like Wikipedia) returns `{ data: { fetchedAt, articles }, stats }`, stored with `saveContext`; `lib/wars.mjs` reads it with the conflict figures.

### Add a map mode
- **For a risk category:** add `{ id, create: risk({ mode, view: 'category', category, categories? }), entry: (m) => m.risk }` to `MODES` in `datasets/registry.js` (`categories` shows several as one, like Disasters), and `modes.<id>.label` and `.title` to every locale. A mode with its own cards wraps the risk mode, as `datasets/wars/` does. The browser tests in `tests/e2e/risk.test.mjs` list the risk modes they check. A removed mode goes into `RENAMED`, so old links still open something.
- **For another dataset** (e.g. flights):
  1. **Scale:** decide the dataset's value scale. It may not be levels 1–4. Colour classes are the dataset's choice; add CSS tokens for them.
  2. **Pipeline:** add `config/datasets/<id>.json` and its providers, as above. If the published record shape differs, add a builder next to `buildProvider` and dispatch on the dataset in `buildSite`. The manifest already lists datasets.
  3. **Site:** create `site/js/datasets/<id>/` implementing the interface (`logic.js` pure, `index.js` views), and add a mode for it to `MODES`, whose `entry` finds its manifest entry.
  4. **Translations** under `datasets.<id>.*` and `modes.<id>`, and data and browser tests.

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
| `config/places.json` | `places(id PK, name, iso2, iso3, shape, point)` |
| translations of place names | `place_names(place_id, locale, name)` (optional; Intl covers most) |
| `config/datasets/*.json` | `datasets(id PK, scale, recent_windows, default_recent_window)` |
| `config/providers/*.json` | `providers(id PK, dataset_id, flag, home_place_id, list_url)` plus `provider_aliases(provider_id, title, place_id)`, `provider_codes(provider_id, code, place_id)`, `provider_territories`, `provider_covered_by(provider_id, place_id, title)` |
| `data/snapshots/…` | `snapshots(provider_id, fetched_at, payload)`, or keep only records |
| `site/data/<dataset>/<provider>.json` | `records(provider_id, title, level, updated, url, regional)` plus `record_places(record_id, place_id, role: own/covers)` |
| `data/history/*.json` | `level_history(provider_id, title, date, level, from_level, up, source)`; `levelChanges` and `trackedSince` become a query |
| `logs/fetch/*.jsonl` | `fetch_runs(time, provider_id, run, result, duration_ms, calls jsonb, stats jsonb)` |
| `data/events/*`, `data/archive/events/*` | `events(id PK, source, code, native_value, starts, ends, current, point, …)` plus `event_revisions(event_id, at, value)` |
| `data/signals/current.json` | `signals_current(category, place_id, level, since, from_level, basis, pending_level, pending_since)` |
| `data/changes/*.jsonl` | `changes(id PK, at, kind, category, place_id, from_level, to_level, up, basis, sources)`, indexed by `at` and `place_id` |
| `data/sources-state.json` | `source_state(id PK, last_attempt, last_success, duration_ms, records, consecutive_failures, error)` |

Steps:
1. **Pipeline:** implement a `DbStore` with the same methods as `FileStore` (`places`, `dataset`, `provider`, `snapshot`/`saveSnapshot`, `history`/`saveHistory`, `publish`) and pass it to the scripts.
2. **API:** serve the same JSON shapes (`manifest`, `places`, `<dataset>/<provider>`) from an API, then point `createDataClient({ base })` at it. The site needs no other change.
3. **Tests:** keep the data tests. They compare what is served against a fresh build.

## Testing and deployment

See the README's **Tests** section. In short:
- `npm run test:coverage` runs the unit and data tests, failing below the coverage thresholds;
- `npm run test:e2e` runs the browser tests. Real level changes are rare, so tests of pulses and the feed inject them with `withLevelChanges()` (`tests/e2e/helpers.mjs`) and never depend on the world having had one lately;
- `.github/workflows/deploy.yml` runs both and deploys `site/` only if they pass.

The update (`update.yml`) runs hourly. `scripts/due.mjs` decides what is due (`config/schedule.json`): advisories once a day at a pseudo-random hour, GDACS every hour. It fetches those, builds, commits, and then calls the same test-and-deploy workflow. A manual run fetches everything, or the ids given in its `sources` input.
