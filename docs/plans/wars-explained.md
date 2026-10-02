# Wars explained: plan and progress

> **In progress.** This is the live checklist of the "Wars explained" revision, approved by the owner on Oct 2, 2026. Every box is ticked as soon as its item is done, and the doc is committed with each part, so the owner can follow progress and an interrupted session can pick up here.
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

The owner asked for a **more minimal, easier right panel**, for **more reasons to visit**, and for visitors to **quickly understand who fights whom** in each war.

A review of the code and data (Oct 2, 2026) found:

- **About 45 pieces of text and controls in the Wars panel at once, and part of it is dead weight.**
  - The Wars feed is always empty: conflict levels rarely change, so it says "0 · No changes in this period".
  - The Filters only filter that feed.
  - The footer has 9 source links.
- **Who fights whom is never shown.**
  - `conflict.json` has `sideA` and `sideB`, but no site code reads them.
  - They come from the first event row of a conflict, so each conflict has one opponent. Sudan's war reads "Government of Sudan vs SFA", without the RSF.
- **No list of the 16 wars anywhere.** Conflicts only appear inside a place's card.
- **Open data can tell who fights whom:**
  - UCDP's candidate events carry `side_a`, `side_b` and the actor ids on every row. We drop them today.
  - Wikipedia's "Infobox military conflict" lists `combatant1..3` with "Supported by" backers (CC BY-SA 4.0, no key). Its REST summary gives a short extract, the link, and often a territory map from Commons.
  - Wikidata models sides well only for the Ukraine war, so it isn't enough.
  - Not usable:
    - ACLED and HDX HAPI's conflict events (ACLED terms);
    - ReliefWeb (an approved appname is required since Nov 2025);
    - IPC (a reviewed key);
    - DeepStateMap and ISW front lines (reuse forbidden);
    - Correlates of War (no redistribution);
    - SIPRI arms transfers (fair use only).
  - For later: UNHCR displacement and World Bank population (CC BY 4.0, no key).

**The owner's decisions (Oct 2, 2026):**
- Sides come from **UCDP and Wikipedia**. A **short Wikipedia extract** is shown, credited and linked.
- Extras: **the latest month's UCDP events as dots**, **new and ended conflicts**, and **USGS earthquakes and NASA EONET in Disasters**.
- **Wars first, then a lighter pass on the other modes.**

## The result

- **The Wars panel:**
  - Header and search, unchanged.
  - **Overview card** (fixed height):
    - the war count with its sparkline (the sub-line moves to a tooltip and the help);
    - the month's deaths;
    - Escalating, Calming and **New** chips;
    - Tensions;
    - "All countries →".
  - **A Wars list** instead of the empty feed.
    - One row per war, by deaths in 12 months, with its trend: "Russia vs Ukraine · 97,739".
    - The first 8, then "Show all" (every armed conflict).
    - Hovering a row colours its sides on the map; clicking opens the war card.
  - **No Filters in Wars.**
  - **A one-line footer.**
- **The war card** (fixed height), from a war row, a conflict row or `#mode=wars&war=1-13243`:
  - "War · since Feb 2022";
  - the title;
  - **Side A vs Side B**, with "Backed by …" per side;
  - deaths in 12 months and last month, with the trend;
  - 12 monthly bars for the war;
  - a 2-line Wikipedia extract, credited;
  - links to Wikipedia, UCDP and the territory map.
- **The map:**
  - a hovered or selected war colours Side A and Side B in two hues, outlines where it's fought, and fades the rest;
  - **dots** for the latest month's deadly events.
- **Place card and country view:** conflict rows name both sides and open the war card.
- **The other modes:**
  - a one-line footer;
  - an empty feed takes one line;
  - the Disasters overview counts the alerts on the map;
  - **USGS earthquakes (M5+) and EONET events** are added as markers, never a level.

## Status

- **Current step:** 3.8
- **Done:** parts 0–2; 3.1–3.7
- **Last commit of this revision:** 718728f

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

## Part 1: UCDP keeps the sides, civilians and points

- [x] 1.1 `scripts/providers/ucdp/parse.mjs`:
  - also keep the side ids and names, `deaths_civilians`, `latitude`, `longitude` and `where_prec`;
  - a per-version `actors` table (id → name);
  - a `format` number, so an old-format file is refused instead of misread.
- [x] 1.2 Download the stored versions again (a `refetch` option in the fetcher, through `FileStore`), then `npm run build`. Levels and the war count stay the same.
- [x] 1.3 `scripts/lib/conflict.mjs` publishes:
  - per conflict:
    - `sides` (every actor with deaths in the window, by deaths, governments mapped to places);
    - `months` (12);
    - `civilians12`;
    - `first` (the first month in the data);
  - top level:
    - `new` (armed conflicts first seen in the last 12 months);
    - `ended` (100+ deaths in the 12 months before, none in the last 3).
- [x] 1.4 A published `risk/ucdp-events.json`: the latest month's located events (no country-wide rows), in the manifest.
- [x] 1.5 Tests:
  - [x] unit: the parser (new columns, actors, old format refused) with real rows, including a Sudan RSF row.
  - [x] unit: conflict sides from several dyads, `new`, `ended`, the events file.
  - [x] data and project: the events file equals a fresh build; the manifest lists it.
- [x] 1.6 Ship. Live check: `conflict.json` has Sudan's sides with RSF. Then one update run (`-f sources=ucdp`), watched.

## Part 2: Wikipedia context

- [x] 2.1 `config/sources/wikipedia.json`:
  - `kind: "context"` (never a level or a change);
  - the licence and the User-Agent;
  - `articles`: UCDP conflict key → article title, checked by hand for every war and the larger armed conflicts.
- [x] 2.2 `scripts/providers/wikipedia/parse.mjs` (pure):
  - the infobox's combatants, backers and start date;
  - the REST summary (extract, URL, revision, lead image);
  - the Commons licence of the map.
- [x] 2.3 `scripts/providers/wikipedia/index.mjs`:
  - per article, the summary and the infobox (and the map's licence);
  - weekly in `config/schedule.json`;
  - stored through `FileStore`;
  - a failed article keeps its last entry.
- [x] 2.4 Build: a published `risk/wars.json` (in the manifest). A war without an article is a warning, and the site falls back to UCDP's sides.
- [x] 2.5 Wiring: `SOURCES`, `update.yml`, the Fetch results table, `logs/README.md`.
- [x] 2.6 Tests:
  - [x] unit: the infobox parser on real wikitext (Ukraine, Sudan, Myanmar, Gaza, DR Congo, no infobox).
  - [x] unit: the fetcher (failure keeps the last entry, the User-Agent), the build and its fallback.
  - [x] data and project: `risk/wars.json` equals a fresh build; the source is wired.
- [x] 2.7 Ship. Live check: `risk/wars.json` has the sides and backers of Ukraine and Sudan. Then one update run (`-f sources=wikipedia`), watched.

## Part 3: The Wars panel

- [x] 3.1 `site/js/datasets/wars/logic.js` (pure): `warRows`, `warModel`, `sideLabels`, `newRows`.
- [x] 3.2 The Wars list instead of the feed; no Filters in Wars; the overview's New chips (the sub-line moves to a tooltip).
- [x] 3.3 The war card (fixed height), the `war` target, and `war=` in the URL.
- [x] 3.4 The map: the sides of a hovered or selected war in two hues, where it's fought outlined, the rest faded; the latest month's events as dots.
- [x] 3.5 Place card and country view: both sides per conflict, and buttons to the war card.
- [x] 3.6 Text: the new `wars.*` keys; the help explains the sides and the dots.
- [x] 3.7 Tests:
  - [x] unit site: `warRows`, `warModel` (Wikipedia sides, UCDP fallback, unnamed groups), `newRows`, `sideLabels`.
  - [x] e2e: the Wars list (8, then all); hovering highlights the sides; clicking opens the war card; fixed height; `#war=` and Back; dots and their tooltip; phone.
  - [x] edited: the per-mode loop for Wars, Filters in Wars, the overview, the place card's conflict rows, the shots and live-check lists.
  - [x] deleted: the Wars feed tests.
- [ ] 3.8 Ship. Live check: the Wars list; `#mode=wars&war=1-309` opens Sudan with SAF vs RSF; dots; no console errors.

## Part 4: The other modes, USGS and EONET

- [ ] 4.1 A one-line footer in every mode, with "About and sources" opening the help (which lists every source and licence).
- [ ] 4.2 An empty feed takes one line. The Disasters overview counts the alerts on the map.
- [ ] 4.3 USGS earthquakes (M5+, the significant and 4.5 feeds) and NASA EONET (volcanoes, storms, wildfires): markers only, hourly, without GDACS duplicates.
- [ ] 4.4 Tests:
  - [ ] unit: the USGS and EONET parsers on real responses; the duplicate rule.
  - [ ] data and project: the sources are wired; the events equal a fresh build.
  - [ ] e2e: the footer, the empty feed, the Disasters count, a USGS marker card.
- [ ] 4.5 Ship. Live check: quake markers in Disasters, no GDACS duplicate. Then one update run (`-f sources=usgs,eonet`), watched.

## Part 5: Docs and wrap-up

- [ ] 5.1 `docs/architecture.md`, README, and `.claude/CLAUDE.md` (code map, panel order, card slots, source quirks for Wikipedia, USGS and EONET, the UCDP fields, current state).
- [ ] 5.2 Review screenshots: desktop, phone, tablet 768, landscape 844×390, both themes, a war hovered and selected.
- [ ] 5.3 Ship and report.

---

## Log (one line per finished part: commit, deploy, tests)
- Part 1: 86cacdf (+ 9239dd4 test fix), deploy green after the test fix (the first deploy failed: two header checks anchored at 'Updated'), live: Sudan's sides SFA, RSF; 4 new, 10 quiet; conflict-events.json 186 KB; update run 37041430778 (ucdp) green. Tests added: parser points and side ids, refetch of outdated versions, stored tables, sides from several dyads, new and quiet, dots, old format refused, data checks of sides and dots, e2e one-line header with delayed sources and the moves line with big numbers. Edited: UCDP fixture (+ a real Sudan-RSF row), parser, conflict and risk-layer tests, header texts, two e2e header checks. Deleted: none.
- Part 2: 51f0eec (+ 718728f bot-data merge), deploy green, live: risk/wars.json with 38 conflicts (Ukraine A with Belarus, North Korea; Sudan RSF and SFA spelled out); update run 37043453470 (wikipedia) green. Tests added: the parser on real articles (Ukraine, Sudan, Lebanon, Mali, the 2026 Iran war and its template, Venezuela), the fetcher, side matching, risk/wars.json in the risk layer, store and runFetch for a context source, run descriptions, data and project checks. Edited: the provider list, project checks for a context kind. Deleted: none.
