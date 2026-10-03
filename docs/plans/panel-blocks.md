# A panel of blocks: plan and progress

> **In progress.** The live checklist of the "panel of blocks" revision, approved by the owner on Oct 3, 2026. Every box is ticked as soon as its item is done, and the doc is committed with each part.
>
> **How to resume after an interruption:**
> 1. Read the repo copy.
> 2. Run `git status` and `git log --oneline -10`.
> 3. Continue from the first unchecked box.
> 4. If a part was half done, check its working-tree changes and rerun its tests before going on.
>
> **Owner's rules:** one part = one commit, tested, pushed and deployed, before the next part starts. Tick each box when it's done (`npm run tick`).

## Context (why)

The owner (Oct 3, 2026): the right panel has too many details. People want a minimal, understandable panel with limited information:

- **Blocks:** the panel is a column of short blocks, each informative on its own.
- **No "Country details" link:** clicking (selecting) a country updates the panel.
- **Hover changes nothing in the panel:** only the tooltip at the cursor shows short info.

**The owner's decisions:**
- All four modes in this revision.
- The Filters go; one 7 / 30 / 90 days switch stays, in the Latest changes block.
- On phones, a tap shows the short sheet over the map, with "Details" jumping to the updated panel.

## The result

- **Hover:** the panel never changes. The map's tooltip says the essentials (the name, the level, one key fact). Hovering a row in a block highlights its place or war on the map only.
- **Click:** selects a country, a war or an alert. The panel shows its blocks until × in its first block, Escape, or a click on the ocean.
- **Nothing selected:**
  - **Wars:** "Wars now" (count, sparkline, last month's deaths), "Deadliest" (top 5, then all and those gone quiet), "Changing" (escalating, calming, new), "Tensions".
  - **Disasters and All:** "Now" (places above Normal, by level; alerts on the map), "Latest changes" (with the 7 / 30 / 90 days switch).
  - **Travel:** "Now" (the government's advisories by level), "Latest changes".
- **A country selected:** a head block (name, the mode's level, ×), then the mode's own block (Wars: deaths, months, its wars; Disasters: its alerts; Travel: the government's advisory; All: every category's level), then short blocks for the rest: armed violence, travel advice (each government, one line), alerts, news and tensions, recent changes.
- **A war or an alert selected:** its blocks (sides, deaths, months, summary; the alert's facts).
- **Gone:** the fixed-height card, "Country details →", the separate country view (`view=country` links select the country), the change feed below the card, the Filters, "All countries →" in the card (the header's list button stays).

## Status

- **Current step:** 3.5
- **Done:** parts 0–2
- **Last commit of this revision:** b5bb22c

## Every part ends with the same checks

- `npm run test:coverage` and `npm run test:e2e`: all green.
- Screenshots (`npm run shots`), desktop and phone, both themes, looked at.
- Commit, with this doc's boxes ticked; `npm run merge-bot-data` if the bot committed; push; `gh run watch` the deploy until green; `npm run live-check`.
- Record the tests added, edited and deleted in the Log.

---

## Part 0: Set up

- [x] 0.1 This doc, linked from "Current state" in `.claude/CLAUDE.md`. Commit and push.

## Part 1: Hover informs, click selects

- [x] 1.1 Hovering a country, marker, dot or row changes nothing in the panel: the map highlights it and the tooltip says the essentials (Wars: the deaths and its deadliest war).
- [x] 1.2 Clicking selects; × in the panel, Escape and the ocean clear the selection.
- [x] 1.3 Tests: the hover and selection rules (e2e), the tooltips (unit); edited: tests that hovered to read the card.
- [x] 1.4 Ship.

## Part 2: The overview as blocks

- [x] 2.1 The panel body is a column of blocks (no fixed height); the change feed and the Filters leave the static page.
- [x] 2.2 Wars: Wars now, Deadliest, Changing, Tensions.
- [x] 2.3 Disasters and All: Now, Latest changes (7 / 30 / 90 days). Travel: Now, Latest changes.
- [x] 2.3b The levels are switched on and off in the map's legend at the bottom (the owner, Oct 3, 2026), not in the panel.
- [x] 2.4 Tests: the blocks of each mode (unit, e2e), the window switch; deleted: Filters, fixed-height and feed tests.
- [x] 2.5 Ship.

## Part 3: A selected country, war or alert as blocks

- [x] 3.1 The head block (name, the mode's level, ×) and the mode's own block first.
- [x] 3.2 The other blocks from the place file: armed violence, travel advice, alerts, news and tensions, recent changes. The separate country view and its links go; `view=country` links select the country.
- [x] 3.3 A war's and an alert's blocks.
- [x] 3.4 Tests: the blocks for a country in each mode, a war, an alert, old links (unit, e2e); deleted: country-view tests.
- [ ] 3.5 Ship.

## Part 4: Phones, docs and wrap-up

- [ ] 4.1 The phone sheet: the short info and "Details" jumping to the panel's blocks.
- [ ] 4.2 `docs/architecture.md`, README, `.claude/CLAUDE.md`.
- [ ] 4.3 Review screenshots: desktop, phone, tablet, both themes, selected and not.
- [ ] 4.4 Ship and report.

---

## Log (one line per finished part: commit, deploy, tests)
- Part 1: 84448b9, deploy green, live: every mode ok. Tests added: Escape and × clear the selection, the Wars tooltip's war. Edited: hover tests (the panel stays; a click shows), measureCards selects. Deleted: none.
- Part 2: the overview as blocks and levels in the legend, deploy green after a test flake fix (the × clicked through the DOM); merged the owner's capybara commit; live: every mode ok. Tests added: legend level switches, the window switch, no Filters in any mode, overview blocks. Edited: overview, feed, legend, countries list, Travel provider and window, Wars list (5), phone sheet. Deleted: the Filters' tests, the fixed-height card checks, the overview's latest list and raised/lowered line.
