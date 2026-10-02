# UX revision 2: plan and progress

> **This is the live checklist** of the second UX revision, approved by the owner on Oct 2, 2026. Every box is ticked as soon as its item is done, and the doc is committed with each part, so the owner can follow progress and an interrupted session can pick up here.
>
> **How to resume after an interruption:**
> 1. Read the repo copy.
> 2. Run `git status` and `git log --oneline -10`.
> 3. Continue from the first unchecked box.
> 4. If a part was half done, check its working-tree changes and rerun its tests before going on.
>
> **Owner's rules:**
> - One part = one commit, tested, pushed and deployed, before the next part starts.
> - Tick each box when it's done.
> - Commit anything uncommitted before starting.

## Context (why)

A second review used screenshots of the live site in 30 states, plus measurements of the data and the DOM. It found the following, and the owner chose to fix it now:

- **Map bugs:**
  - A link with a place (`#mode=highest&place=de`) selects it but never zooms. Cause: `WorldMap.layout()` (`site/js/map/world-map.js:149-172`) resets the zoom on every call, and the `ResizeObserver` always fires once after startup.
  - The same reset throws the zoom away on any resize.
- **The Changes mode highlights places whose only change is news activity** (Greenland, Spain, France, Argentina). Their levels didn't change. In `style()` (`datasets/risk/index.js`), `changed` counts every kind of change.
- **The Travel header wraps to two lines,** so the panel moves 18px between Travel and the risk modes.
- **Noise:**
  - 34 of the 47 feed items (30 days) are GDELT news transitions ("Protest reports back to normal"). They also fill "Latest changes", tooltips and the card's history.
  - Every card says "Security and unrest: coming later".
  - The Travel overview is half empty.
- **Travel = the highest of five governments,** so one government alone sets the level in 43 places. Bahrain, for example, is Critical only because of the Netherlands. The owner chose **two or more governments**: 141 places above Normal instead of 162. No false changes are recorded, because travel changes come from each government's own history.
- **Extras chosen:** country names when zoomed in, alerts in the search, and sharing a country.

Offered but not chosen this round (they go into the "Offered" list in `.claude/CLAUDE.md` in part 7):
- the tablet and landscape layout (761–1024px);
- a bigger map on phones;
- an accessibility pass (hover announcements, focus, contrast);
- active alerts in Disasters and Wildfires;
- a watchlist and "since your last visit";
- a data-status view and auto-refresh (`risk/health.json` is published but unused).

## Status

- **Current step:** 3.7 (ship)
- **Done:** parts 0–2; 3.1–3.6
- **Last commit of this revision:** 05cb8c1 (part 2)

## Every part ends with the same checks (the "ship" boxes)

- `npm run test:coverage`: all green, at or above 90/85/85.
- `npm run test:e2e`: all green.
- Screenshots at 1440 and 390px in both themes, from a session-scratchpad script against `node scripts/serve.mjs <port>`, looked at.
- Commit, with this doc's boxes ticked. Then `git fetch`; merge any bot data commits with the scratchpad `merge-data.sh`. Push, then `gh run watch` the deploy until green.
- Open the live site in headless Chrome: no console errors, plus the part's own live check.
- Record the tests added, edited and deleted under the part.

---

## Part 0: Set up

- [x] 0.1 Copy this plan into the repo as `docs/plans/ux-revision-2.md` (no personal paths: the project test scans tracked files). Link it from "Current state" in `.claude/CLAUDE.md`.
- [x] 0.2 Commit everything uncommitted, with the doc (`git status` must be clean afterwards). Push; the deploy goes green.

## Part 1: Map and mode bugs

- [x] 1.1 `WorldMap.layout()`:
  - return early when the container size is unchanged;
  - on a real resize, keep the view: take `k` and the geographic point at the view's centre (`projection.invert(transform.invert([w/2, h/2]))`), refit, then put that point back at the centre with the same `k`;
  - fall back to the identity transform if the point isn't finite.
- [x] 1.2 In `style()` (`datasets/risk/index.js`), `changed` counts only `PULSE_KINDS` changes. That fixes the Changes mode and "Fade places without a recent change".
- [x] 1.3 Travel `header()` (`datasets/travel-advisories/index.js`) becomes "Data as of {date}", and the stale form "Data as of {date} ({age})". Edit `datasets.travel-advisories.header` and `headerStale` in `site/i18n/en.json`.
- [x] 1.4 Tests:
  - [x] e2e: a link `#mode=highest&place=de` zooms (the `.viewport` scale is above 1 after about 1.2s; this fails before 1.1).
  - [x] e2e: after zooming to Germany, collapsing the panel and changing the viewport keep the scale, and Germany stays on screen.
  - [x] e2e: the search box has the same top in Travel and Highest, at 1440 and 390px.
  - [x] e2e, edit: `site.test.mjs` "the provider switch changes header…" now expects Canada in the overview eyebrow and footer, not the header.
  - [x] unit: in the Changes view, a place with only an anomaly is faded, and one with a level change isn't.
  - [x] unit, edit: the Travel header texts in `tests/unit/site/dataset.test.mjs`.
- [x] 1.5 Docs: `docs/architecture.md` (the map keeps the view on resize; the Travel header).
- [x] 1.6 Ship (see "Every part ends with…"). Live check: `#mode=highest&place=de` zooms.

## Part 2: Travel level = two or more governments

- [x] 2.1 `travelSignals()` (`scripts/lib/risk.mjs:60`):
  - sort the levels from high to low; the level is the second one, or the only one when a single government covers the place;
  - `agree` is the number of governments at this very level (changed from "or above" in part 3: "5 of 5" at Normal said nothing);
  - add `strictest: { level, by: [providerIds] }` only when a government is stricter.
- [x] 2.2 Run `npm run build` to regenerate `site/data/risk/**`. There's no stored travel state, and travel changes come from `advisoryChanges()`, so no change is recorded. Check that `site/data/risk/changes.json` didn't grow.
- [x] 2.3 Site:
  - `basisText()` (`datasets/risk/index.js`) and the travel basis from `cardModel()` (`logic.js`) read "3 of 5 governments · Netherlands stricter" (new key `risk.card.travelStricter`).
  - Edit `help.travel` and `help.levels.2`–`4` in `en.json`.
- [x] 2.4 Tests:
  - [x] unit pipeline (`tests/unit/pipeline/risk.test.mjs`, rewrite the `travelSignals` tests):
    - `{us:4, ca:3}` gives 3 with `agree` 2 and `strictest {4,['us']}`;
    - a tie gives no `strictest`;
    - one government gives its own level;
    - the Bahrain case gives 3.
  - [x] unit site: a fixture place with a stricter government (e.g. `ke`: `natives {us:3, ca:2}`, level 2, `strictest {3,['us']}`) shows "· U.S. stricter".
  - [x] the data tests pass after the rebuild.
- [x] 2.5 Docs:
  - `docs/architecture.md:105` (the Travel signal);
  - README "What it shows";
  - `.claude/CLAUDE.md` (the risk-layer note, "Current state").
- [x] 2.6 Ship. Live check: the overview shows about 141 places above Normal.
- [x] 2.7 Run `gh workflow run update.yml --ref main -f sources=gdacs`, `gh run watch` it until green, then `git pull`.

## Part 3: Signal over noise

- [x] 3.1 Keep `kind: 'anomaly'` out of:
  - `feedItems()`, which also feeds "Latest changes";
  - `tooltip()`, `feedKeyFor()`;
  - `cardModel().history` (`logic.js`);
  - the country view history (`countryHtml()`).

  The pipeline keeps publishing these records. Delete what becomes unused: the anomaly branch of `changeText()`, and the keys `risk.change.anomaly` and `risk.activity.change.*`.
- [x] 3.2 "Unusual news activity" section, in Highest and Changes only:
  - in `index.html`: `<section class="section news" id="newsSection">` with a heading, a count, `#newsList`, and a one-line note (news counts, never a level);
  - an optional dataset method `renderNews(el)`, documented in `datasets/registry.js`. In the risk dataset it reads `current.activity[source].places`;
  - rows: place and "Violence reports far above normal", from `activity.item` and `activity.status.*`. Order: `far`, then `above`, then by count/expected, then by name;
  - the first 5, then "Show all N" (the `data-feed-all` pattern);
  - `main.js` shows the section only when the dataset renders it. Rows carry `data-place`: click selects with zoom, hover previews, wired like the feed.
- [x] 3.3 Card slot: "Security and unrest: coming later" (`card.later`) becomes "News: no unusual activity (GDELT)" (new `risk.activity.quiet`, in `newsLine()`). The slot stays, so the height stays fixed. Delete `risk.card.later`.
- [x] 3.4 Travel overview: "Latest level changes", the top 3 of `recentRecords()` (`travel-advisories/logic.js:39`), as `data-key` buttons (main's `onListClick` handles them). Empty: the empty state with "Show 90 days". Off: hidden.
- [x] 3.5 Tests:
  - [x] unit, rewrite the anomaly tests (~712, ~721 in `tests/unit/site/risk.test.mjs`): an anomaly is not in the feed, Latest changes, the tooltip or the history, and doesn't un-fade in the Changes mode.
  - [x] unit: `renderNews` order, cap and Show all; hidden in category modes and without activity.
  - [x] unit, edit: the quiet line replaces "coming later" (~250, ~682-688); the cardModel history excludes anomalies.
  - [x] unit: the Travel overview's latest changes and their empty state (`dataset.test.mjs`).
  - [x] e2e: `withRiskChanges()` (`tests/e2e/helpers.mjs`) gains an injected anomaly and an activity entry in `risk/current.json`. The feed doesn't list the anomaly; the news section lists the place and a click selects it; the section is hidden in Disasters and Travel.
  - [x] `measureCards()` keeps the fixed card height in every mode; `tests/data/project.test.mjs` keys pass.
- [x] 3.6 Docs: `docs/architecture.md` (feed kinds, the news section, `renderNews`), README, `.claude/CLAUDE.md` ("Only level changes count", now with alerts).
- [ ] 3.7 Ship. Live check: the feed has no GDELT items, and the news section lists the countries.

## Part 4: Search finds alerts

- [ ] 4.1 `searchEntries()` (`datasets/risk/index.js`) adds active alerts:
  - included: named alerts (cyclones, floods, volcanoes, droughts, WHO notices) and any Orange or Red alert; in a category mode, only that category;
  - left out: Green forest fires (a generic repeated name, about 140 entries);
  - entry: `{ label: e.name, aliases: [type name], swatch, sub: "Red alert · Cyclone", target: eventTarget(id) }`.
- [ ] 4.2 `WorldMap.zoomToMarker(id)` centres on a shown marker at k ≥ 3 and returns false when the marker isn't shown. `select()` in `main.js` tries it, then falls back to `zoomTo(placeId)`.
- [ ] 4.3 An optional `searchPlaceholder()` gives "Find a country or alert" in the risk modes; Travel keeps "Find a country". `refresh()` sets the placeholder and aria-label.
- [ ] 4.4 Tests:
  - [ ] unit: alert entries with event targets, Green fires left out, category filter, placeholder.
  - [ ] e2e: type "Test cyclone" (a `withRiskChanges()` event), press Enter: the event card shows and its marker is selected.
- [ ] 4.5 Docs: architecture (search), README.
- [ ] 4.6 Ship. Live check: searching for a named cyclone or flood opens its card.

## Part 5: Share a country

- [ ] 5.1 A "Share" button in the country view header (`countryHtml()`, `data-action="share"`). `renderCountryView` takes a `share` handler beside `back` and `selectEvent`.
- [ ] 5.2 Main builds the link with `formatHash({ mode, place, view: 'country' })`.
  - On touch screens (`(pointer: coarse)`), use `navigator.share` if it exists.
  - Otherwise use `navigator.clipboard.writeText` and the toast "Link copied", or "Couldn't copy the link" on failure.
- [ ] 5.3 A new `<div class="toast" id="toast" role="status" hidden>` at the bottom centre of the map area, hidden after 2.5s. i18n: `risk.country.share`, `share.copied`, `share.failed`.
- [ ] 5.4 Tests:
  - [ ] unit: the share action calls its handler.
  - [ ] e2e: grant the clipboard permissions, click Share: the clipboard holds `…#mode=highest&place=jp&view=country`, and the toast shows.
- [ ] 5.5 Docs: architecture (the country view), README.
- [ ] 5.6 Ship. Live check: Share copies the link.

## Part 6: Country names when zoomed in

- [ ] 6.1 New `site/js/map/labels.js`: pure `placeLabels(candidates, { width, height, top, bottom, charWidth, minArea, max })`.
  - Candidates are `{ key, x, y, area, text }`.
  - Largest first; a box is estimated from the text length; skip a box that overlaps a placed one, leaves the view, or falls under the insets.
  - At most about 80.
- [ ] 6.2 `WorldMap`:
  - a new `labelFor(placeId)` option; `main.js` passes `id => i18n.placeName(places.get(id))`;
  - a label layer in the screen-space `overlay`, after the dots and before the markers;
  - `#applyTransform()` updates it: no labels below k = 2.5; above it, regions with `areaPx · k²` ≥ 1600 px².
- [ ] 6.3 CSS `.map-label`: 11.5px, weight 600, `fill: var(--text)`, a `var(--panel)` halo (`paint-order: stroke`), `pointer-events: none`. Both themes.
- [ ] 6.4 Tests:
  - [ ] unit (`tests/unit/site/labels.test.mjs`): largest first, no overlaps, insets, cap, area threshold.
  - [ ] e2e:
    - no labels at k = 1;
    - after choosing Germany in the search, the labels include "Germany";
    - no two boxes intersect, all are inside the map;
    - hover and click still reach the countries.
- [ ] 6.5 Docs: architecture (the map), README.
- [ ] 6.6 Ship. Live check: zooming into Europe shows names.

## Part 7: Wrap-up

- [ ] 7.1 `.claude/CLAUDE.md`:
  - "Current state": revision 2 done, linking this doc;
  - add the not-chosen items to "Offered to the user, not decided yet".
- [ ] 7.2 Tick the remaining boxes and set Status to done; commit and push the doc; the deploy goes green.
- [ ] 7.3 Stop any local server that was started. Report each part, with its tests added, edited and deleted.

## Log (one line per finished part: commit, deploy, tests)

- Part 1: eb89206, deploy green, live check passed (link zooms to scale 10, one-line headers, no console errors). Tests added: e2e link zoom + resize keeps view, e2e panel doesn't move between modes (1440, 390), unit Changes fade ignores news. Edited: unit Travel header texts, e2e provider-switch test. Deleted: none.
- Part 2: 05cb8c1, deploy green, live overview 141 places above Normal (was 162), no console errors; update run 36959859838 (gdacs) green, built with the new rule (bot commit c842ed2). Tests added: travelLevel cases (Bahrain, Georgia, Argentina, India), site unit for the stricter flag. Edited: travelSignals unit tests, data test checks travelLevel(). Deleted: none.
