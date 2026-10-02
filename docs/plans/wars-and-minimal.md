# Wars first, fewer tabs: plan and progress

> **Done (Oct 2, 2026).** This was the live checklist of the "Wars first" revision, approved by the owner on Oct 2, 2026. Every box is ticked as soon as its item is done, and the doc is committed with each part, so the owner can follow progress and an interrupted session can pick up here.
>
> **How to resume after an interruption:**
> 1. Read the repo copy.
> 2. Run `git status` and `git log --oneline -10`.
> 3. Continue from the first unchecked box.
> 4. If a part was half done, check its working-tree changes and rerun its tests before going on.
>
> **Owner's rules:**
> - One part = one commit, tested, pushed and deployed, before the next part starts.
> - Tick each box when it's done (`npm run tick`).
> - Commit anything uncommitted before starting.

## Context (why)

The owner asked for a site that is **super minimal**, **interesting from the first view**, and shows **the current situation in the world and how it changes, focused on (potential) war**: a **Wars** tab with the number of conflicts and how it moves. They also asked whether an **AI chat** that answers only from the site's data is feasible.

A review of the live site (screenshots, Oct 2, 2026):

- **No story on the first view.**
  - "141 places above Normal" colours most of the map.
  - The feed is seven rows of one Mexico cyclone.
  - "Unusual news activity" leads with Guernsey and Jamaica: noise.
- **No war signal at all.** Ukraine's country view says "News: no unusual activity".
- **GDELT can't count wars.** It measures English news volume: last week's violence counts were US 14,734, Israel 3,359, India 2,400, UK 2,000, Ukraine 1,773; Sudan isn't in the top 30.

The research:

- **UCDP Candidate Events** (Uppsala Conflict Data Program):
  - A monthly CSV at `https://ucdp.uu.se/downloads/candidateged/GEDEvent_v<yy>_0_<m>.csv`, **CC BY 4.0, no key** (its API needs a token; the files don't).
  - About 1.4 MB and 1,800 events a month: date, place (lat/lon, region), conflict, parties, deaths, and type (state-based, non-state, one-sided).
  - v26.0.8 (August 2026) is the latest; v26.0.9 is a 404 until it comes out. Files go back to v24.0.1.
  - Sep 2025–Aug 2026: **16 wars** (state-based conflicts with 1,000+ deaths in 12 months). 18 places had 1,000+ deaths in all armed violence, 20 had 100–999 and 12 had 25–99; the rest of the world stays neutral.
  - Real movement: Yemen 1,380 deaths in August against a usual ~110; Lebanon from 1,340 a month to ~25; Sudan halved.
- **GDELT country pairs** (fighting, threats of force and force posture between two countries' actors) give a sensible "potential war" list:
  - Sep 28–30: Russia–Ukraine, Israel–Palestine, Iran–US, Iran–Israel, Israel–Lebanon, Saudi Arabia–Yemen, US–Venezuela, Poland–Russia, the two Koreas;
  - but also noise (Canada–US, Mexico–US), so each pair is judged against its own normal, and it never sets a level.

**The owner's decisions (Oct 2, 2026):**
- Wars is the first view.
- Wildfires merges into Disasters; the Changes tab goes; the news list leaves the front; repeated feed items are grouped.
- Tensions (GDELT pairs) is built now.
- AI chat: designed now (below), built later.

## The result

- **Tabs:** Wars · Disasters · Travel · All.
  - All is Highest under a new label; its id stays `highest`.
  - Old links and saved modes redirect: `wildfire` → `disaster`, `changes` → `wars`.
- **Wars** (the default for a new visitor):
  - **Map:** places coloured by deaths in armed violence over the last 12 months (UCDP): 1,000+, 100–999, 25–99, and neutral below that.
  - **Overview card:**
    - the number of wars, with a sparkline of the count;
    - the latest month's deaths against the month before;
    - Escalating and Calming;
    - Tensions from the news (at most three);
    - "UCDP, through August 2026 (preliminary)".
  - **Place card:**
    - 12 monthly bars of deaths, and the conflicts fought there;
    - the wars the place is a party to (Russia: party to Russia–Ukraine, fought mostly in Ukraine);
    - deaths between armed groups or against civilians (Mexico) are said to be so, not called a war with the state.
- **All:** gains a Conflict row. The card keeps four category rows (fixed height): Travel, Conflict, Disasters (with wildfires), Health.

## Status

- **Current step:** 5.3
- **Done:** parts 0–4
- **Last commit of this revision:** f214057 (part 4)

## Every part ends with the same checks (the "ship" boxes)

- `npm run test:coverage`: all green, at or above 90/85/85.
- `npm run test:e2e`: all green.
- Screenshots (`npm run shots`), desktop and phone, both themes, looked at.
- Commit, with this doc's boxes ticked. Then `git fetch`, merge any bot data commits (`npm run merge-bot-data`), push, and `gh run watch` the deploy until green.
- `npm run live-check`: no console errors, plus the part's own live check.
- Record the tests added, edited and deleted in the Log.

---

## Part 0: Set up

- [x] 0.1 This doc in the repo, linked from "Current state" in `.claude/CLAUDE.md`. Commit and push; the deploy goes green.

## Part 1: UCDP pipeline and the `conflict` category

- [x] 1.1 `config/sources/ucdp.json`:
  - `kind: "conflict"`, links and terms (CC BY 4.0, and the citation UCDP asks for);
  - the URL pattern, `backfillFrom: "24.0.1"`, `staleAfterHours`;
  - `countries`: UCDP `country_id` (Gleditsch–Ward) → place id, for every name in the files;
  - `regions`: Israel's `adm_1` "Gaza Strip" → `gaza`, "West Bank" → `west-bank`;
  - `bands`: 1,000, 100, 25 deaths in 12 months → levels 4, 3, 2;
  - `trend`: escalating when the last 3 months are ≥ 1.5× the previous 3 and ≥ 150 deaths; calming when they are ≤ 0.5× and the previous 3 are ≥ 150.
- [x] 1.2 `scripts/providers/ucdp/parse.mjs` (pure):
  - a quoted-CSV parser;
  - rows → slim events `{ id, date, place, conflictId, conflict, type, deaths, sideA, sideB, gwA, gwB, lat, lon }`;
  - an unknown country is reported, never placed by guess.
- [x] 1.3 `scripts/providers/ucdp/index.mjs`:
  - asks for the versions after the last stored one, in order (next month; after `.12`, the next year's `.1`);
  - a 404 means "not out yet", which is a success;
  - each version is stored once, in `data/conflict/ucdp/<version>.jsonl`, through `FileStore`;
  - a first run backfills from `backfillFrom`, a few versions per run.
- [x] 1.4 `scripts/lib/conflict.mjs` (pure):
  - merge the versions (dedupe by event id, a later version wins);
  - aggregate per place and per conflict, by month;
  - the rolling 12-month war count per month;
  - bands → levels, escalating and calming;
  - the published `risk/conflict.json`.
- [x] 1.5 `buildRisk()` (`scripts/lib/risk.mjs`): a `kind: 'conflict'` branch.
  - Levels go through `updateSignals()` (category `conflict`).
  - Place files get a `conflict` section.
  - A source in `error` keeps its last state.
- [x] 1.6 Wiring:
  - `config/categories.json`: `conflict`;
  - `SOURCES`;
  - `config/schedule.json`;
  - the `update.yml` step, its failure conditions and the input description;
  - the manifest's `risk.conflict`;
  - `FileStore` methods for the versions;
  - the backfill run locally, then `npm run build`.
- [x] 1.7 All's card: four rows (Travel, Conflict, Disasters = the higher of `disaster` and `wildfire`, Health). The country view lists the same categories. `risk.categories.conflict` in `en.json`.
- [ ] 1.8 Tests:
  - [x] unit: `ucdp.test.mjs` with a real-row fixture (Ukraine, Gaza and the West Bank, an unnamed conflict, Mexico non-state, a backdated event): parsing, mapping, unknown countries, version stepping.
  - [x] unit: `conflict.test.mjs`: dedupe, the rolling war count, bands, escalating and calming.
  - [x] unit: `risk.test.mjs` conflict branch (levels, changes, error keeps state); `providers.test.mjs` fetcher (new version, 404, malformed).
  - [x] unit site: the four card rows, the merged Disasters row.
  - [x] data and project tests: `risk/conflict.json` equals a fresh build, every stored country is mapped, ucdp is wired.
  - [x] e2e: the card rows and fixed heights.
- [x] 1.9 Ship. Live check: All's card shows Conflict for Ukraine. Then one update run (`-f sources=ucdp`), watched.

## Part 2: The Wars mode

- [x] 2.1 `site/js/datasets/wars/logic.js` (pure): `overviewModel()`, `placeModel()`, `bandOf()`, the sparkline.
- [x] 2.2 `site/js/datasets/wars/index.js`:
  - wraps the risk mode on the `conflict` category;
  - its own `load`, overview and place cards (the fixed card height), legend and header.
- [x] 2.3 `MODES`: Wars first, `DEFAULT_MODE = 'wars'`. The country view gets a Conflict section (monthly bars, conflicts, parties, a link to UCDP).
- [x] 2.4 Text: the `modes.wars.*` and wars card strings, the help dialog (bands, war count), the footer's sources.
- [ ] 2.5 Tests:
  - [x] unit site: wars logic (counts, sparkline, escalating and calming, a party to a war, non-state wording).
  - [x] e2e: a fresh visitor gets Wars; a saved mode stays; the overview and place cards; the fixed height; phone.
- [x] 2.6 Ship. Live check: Wars opens first and shows the war count.

## Part 3: The minimal pass

- [x] 3.1 Remove the Wildfires and Changes modes; `RENAMED` redirects old links and saved modes. Disasters shows `disaster` and `wildfire` together. Highest is labelled "All".
- [x] 3.2 Delete the Changes view's code paths. "Fade others" stays in Filters.
- [x] 3.3 The news list leaves the front: `renderNews` is offered in no mode, and the country view keeps the figures.
- [x] 3.4 `groupFeed()` (`risk/logic.js`, pure): one row per place and event or category, newest first.
- [ ] 3.5 Tests:
  - [x] unit: `groupFeed()`; the merged Disasters level and markers.
  - [x] e2e: four tabs; the redirects; the grouped feed; the edited mode lists (`RISK_MODES`, shots, live-check).
  - [x] deleted: the Changes-view and news-list tests.
- [x] 3.6 Ship. Live check: four tabs; `#mode=changes` opens Wars.

## Part 4: Tensions (GDELT pairs)

- [x] 4.1 `countEvents()` also counts pairs: actor country codes (columns 7 and 17) different and both mapped (`actors` in `config/sources/gdelt.json`); force posture (15), fighting (19, 20) and threats of military force (138).
- [x] 4.2 Pair counts in `data/counts/gdelt.json`; the anomaly with a stricter `pairs` rule; published as `activity.gdelt.pairs`.
- [x] 4.3 A one-off local backfill of 98 days.
- [x] 4.4 Site: Tensions in the Wars overview (at most three) and in the country view. Never a level or a pulse.
- [ ] 4.5 Tests:
  - [x] unit: pair counting from real rows; region codes dropped; the anomaly.
  - [x] unit site: the Tensions list.
  - [x] e2e: Tensions shown.
- [x] 4.6 Ship. Live check: Tensions lists pairs.

## Part 5: Docs and wrap-up

- [x] 5.1 `docs/architecture.md`, README, and `.claude/CLAUDE.md` (code map, source quirks for UCDP and the GDELT pairs, current state).
- [x] 5.2 Review screenshots: desktop, phone, tablet 768, landscape 844×390, both themes.
- [ ] 5.3 Ship and report.

---

## AI chat: designed now, built later

- **Feasible, moderate: about 2–3 days.** A bring-your-own-key version is about a day.
- **Server:** the site is static, so the API key needs a small server: a **Cloudflare Worker** (free tier) holding `ANTHROPIC_API_KEY`.
- **Grounding, one call per question:**
  1. The site finds the places named in the question with the search's own `rankMatches()`.
  2. The Worker fetches **only the site's published JSON** for them: the place files, `conflict.json`, `current.json` and `changes.json`.
  3. It passes them as `document` blocks with `citations: { enabled: true }`.
  4. The system prompt says: answer only from these documents, give dates and sources, say when the data doesn't cover the question, and never predict.
  5. Answers stream back, with source chips built from the citations.
- **Model and cost:** Opus 5.5 by default, about $0.06 a question (~12k tokens in, ~600 out, at $4/$20 per million). Haiku 4.5 is about $0.015. The shared world document is prompt-cached.
- **Guards:** Turnstile, a per-IP daily limit, a daily spend cap, short questions only, and three turns of history.
- **The owner provides:** an Anthropic API key with a spend limit, and a Cloudflare account. Also a policy call: today the site shows no generated text, so answers would be labelled "AI summary of the data below".
- **For better answers:** UCDP (this plan); next, the governments' advisory summary texts (open licences).

## Later ideas

- A month slider ("play" the last 24 months on the Wars map).
- The latest month's deadly events as small dots.

## Log (one line per finished part: commit, deploy, tests)

- Part 0: fe66b8e, deploy green. Part 1: 940faca, deploy green, live: All's card shows Ukraine Conflict Critical (97,381 deaths, UCDP), 142 places above Normal, no console errors; update run 36974703851 (ucdp) green: no new version, data through 26.0.8. Tests added: ucdp parser, conflict logic, buildRisk conflict branch, UCDP fetcher, FileStore versions, runFetch conflict kind, data (mapping, bands, war count), project (conflict config), e2e conflict row. Edited: card rows (unit, e2e), risk loading, manifest list, basis check. Deleted: none.
- Part 2: 737d09f, deploy green, live: Wars opens with 16 wars, header 'Conflict data to August 2026', Yemen's card zooms, no console errors in any mode. Tests added: wars logic and view (unit), country view conflict section, registry (Wars first, default, needs conflict data), wars text keys (project), e2e Wars overview and Wars in the per-mode loop (injected Yemen conflict change). Edited: first visit opens Wars, mode count 6, alert-click test hovers off the feed, shots and live-check lists (live-check reads the war count). Deleted: none.
- Part 3: d8e6814, deploy green, live: tabs Wars, Disasters, Travel, All; #mode=changes opens Wars and #mode=wildfire opens Disasters; feed 3 grouped rows (was 14); no news list; no console errors. Tests added: groupFeed, Disasters with wildfires, redirects and four tabs (e2e), grouped feed (e2e). Edited: registry, feed counts, countryRows by categories, notes and header, layout and empty-window tests, Chile marker test, news e2e, tool lists. Deleted: Changes fading, fade-switch and legend cases, newsRows and news section tests.
- Part 4: f214057, deploy green, live: Wars overview lists Tensions (Afghanistan – Pakistan 209 · usually 57, United Kingdom – Iran, Egypt – Israel), Pakistan's country view lists its tension, no console errors; update run 36979530374 (gdelt) green. Pairs backfilled 98 days locally (997 pairs, 10 above normal). Tests added: pair counting (real fixture), prune, fetcher with pairs, tensionSignals and buildRisk, tensionRows and overview Tensions, country view tensions, project and data checks, e2e. Edited: GDELT fetcher tests without pairs. Deleted: the overview's preliminary note.
