# Changes come only from what we observed: plan and progress

> **In progress.** The live checklist of the "observed changes" revision, approved by the owner on Oct 3, 2026. Every box is ticked as soon as its item is done, and the doc is committed with each part.
>
> **How to resume after an interruption:**
> 1. Read the repo copy.
> 2. Run `git status` and `git log --oneline -10`.
> 3. Continue from the first unchecked box.
> 4. If a part was half done, check its working-tree changes and rerun its tests before going on.
>
> **Owner's rules:** one part = one commit, tested, pushed and deployed, before the next part starts. Tick each box when it's done (`npm run tick`).

## Context (why)

On Oct 2, 2026 the feed showed 29 European countries going "Normal → Elevated" for a drought that has been Orange since Dec 2025. Whether an alert was "active" was decided by GDACS's own `iscurrent` flag and end date, and the flag flipped. The 7-day drought tail of Oct 3 still leaned on the source's end date.

**The owner's principle (Oct 3, 2026):** fetch the current state, save it, compare the next fetch with it. Only a difference between our own fetches is a change. What a source says about its own past (flags, "updated" dates, change notes) is never the basis for a change. The site will be quiet until real changes happen; that is accepted.

**The owner's decisions:**
1. A long-running alert is active while the source lists it; `iscurrent` and the end date are ignored.
2. The 10 U.S. changes seeded from change notes are removed.
3. Moment-type facts keep the source's event time for their duration (an earthquake 7 days after it happened, a WHO notice 30 days after publication).

**What the stored history showed (git, Sep 27 – Oct 3, and GDACS live):**
- The flag is wrong both ways: droughts are `false` while ongoing; Mexico's cyclone `TC:1001325` was still `true` three days after its last update, so Mexico was stuck at Critical.
- The flag caused more false changes than the drought: China `1 → 3` (Sep 28) and `3 → 1` (Oct 1); India `3 → 1`, `1 → 3` (Sep 28) and `3 → 1` (Oct 2), all from floods whose flag flipped.
- "Listed" alone is not enough: GDACS's 30-day list still returns alerts that ended weeks ago (a cyclone over Japan, ended Sep 3; a volcano in Indonesia, Sep 4). Madagascar's drought is the only one that left the list.
- End dates lag unevenly: droughts 2–3 days, floods up to 6.6 days (GDACS extends a flood in jumps of 5–6 days), cyclones a few hours.

## The result

An Orange or Red alert of a long-running type is active while both hold:
- **listed:** it is in the latest response; it counts as gone once it has been missing for 24 hours (`unlistedAfterHours`), so one short response doesn't end every alert;
- **alive:** we saw GDACS extend it (its end date or alert level differed from our stored copy) within the type's `quietDays`, on our clock. The first time we see an alert counts.

Only the fact that the record moved between two of our fetches is used, never the flag or the date's value.

| Type | `active` | Days | Why |
|---|---|---|---|
| DR drought | observed | `quietDays` 7 | extended daily |
| FL flood | observed | `quietDays` 7 | extended in jumps of 5–6 days; 3 would flap |
| WF wildfire | observed | `quietDays` 7 | no Orange fire seen yet, so the cautious value |
| TC cyclone | observed | `quietDays` 3 | extended every 6 hours |
| EQ earthquake, VO volcano | event | `tailDays` 7 | a moment (start = end): the source's event time, while listed |
| Green alerts | unchanged | `tailDays` as before | markers only, never a level or a change |
| WHO, USGS, EONET | unchanged | `tailDays` as before | no `active` key: the rule as it was |

`quietDays` is its own key (decided while building it): `tailDays` stays what it was (the days after the source's end date, 3 for floods and wildfires, 0 again for droughts), because the Green markers still go by it and must not change.

**Choices made in the plan:**
- Floods and wildfires get 7 days, so a flood stays High for up to a week after GDACS last extended it. A shorter tail would flap.
- Mexico's and Madagascar's falls at rollout are recorded as changes: they are endings we observe.
- An alert first seen after it already ended (a source's first fetch, or after a long outage) is shown for one tail.
- Not changed: WHO's 30 days and earthquake times (decision 3); UCDP's backfilled months, the war statistics and GDELT's baseline (statistics, never changes); Green markers.
- Not addressed: GDACS rescoring a cyclone every 6 hours (Mexico moved four times in two days). Those are real differences between our fetches; a longer fall confirmation for cyclones is a separate decision.

## Status

- **Current step:** 1.6
- **Done:** Part 0; 1.1-1.5
- **Last commit of this revision:** none

## Every part ends with the same checks

- `npm run build`, then `npm run test:coverage` and `npm run test:e2e`: all green.
- Commit, with this doc's boxes ticked; `npm run merge-bot-data` if the bot committed; push; `gh run watch` the deploy until green; `npm run live-check`.
- After a pipeline change: one `update.yml` run with `-f sources=gdacs`, then `git pull`.
- Record the tests added, edited and deleted in the Log.

---

## Part 0: Set up

- [x] 0.1 This doc, linked from "Current state" in `.claude/CLAUDE.md`. Commit and push.

## Part 1: The active rule

- [x] 1.1 `mergeEvents()` records `updatedSeen` (new, or the end date or alert level moved) and `missingSince` (absent from the response; dropped when it returns).
- [x] 1.2 `config/sources/gdacs.json`: `unlistedAfterHours` 24, each type's `active`, and `quietDays` (droughts, floods and wildfires 7, cyclones 3).
- [x] 1.3 `isActive()`: observed (listed and alive), event (listed, the event time plus the tail), otherwise as it was. An alert active by the observed rule is published as `current`.
- [x] 1.4 Rollout: `updatedSeen` set from the git history on the alerts that set a level today; a replay of every stored GDACS version shows no false change.
  - The replay (35 fetches, Sep 27 – Oct 3): by the flag 38 level changes, exactly those the site recorded (29 for Europe's drought, China and India up and down); by observation 15: Mexico's four real moves, Japan's old cyclone ending (first seen after it ended: the known limit), and **10 real ones the flag hid**: GDACS added Moldova, Montenegro and Norway to Europe's drought on Sep 30 and Russia on Oct 2, five Central African countries on Sep 30 and Costa Rica on Oct 2. Of the 29 rows removed on Oct 3, Russia's was real. Not restored (the owner's call).
- [x] 1.5 Tests:
  - [x] unit: `updatedSeen` and `missingSince` in the merge
  - [x] unit: the drought's flag flipping gives no change
  - [x] unit: a flood whose flag flips ends 7 days after its last extension
  - [x] unit: a cyclone stuck at "current" ends 3 days after its last move
  - [x] unit: a missing alert stays 24 hours, then falls; one that returns changes nothing
  - [x] unit: earthquakes and volcanoes follow their event time; a Green marker keeps the old rule
  - [x] data: every GDACS type has a known `active`
- [ ] 1.6 Ship, with one GDACS update run.

## Part 2: Remove the seeded U.S. changes

- [ ] 2.1 The 10 `source: "note"` entries leave `data/history/travel-advisories.json`; rebuild.
- [ ] 2.2 The dead support goes: `seeded` in `lib/build.mjs` and `lib/risk.mjs`, the `from == null` wording on the site and its i18n keys.
- [ ] 2.3 Tests: deleted the seeded cases (unit, e2e helper); the data test checks that the history holds only observations.
- [ ] 2.4 Ship.

## Part 3: Write the principle down

- [ ] 3.1 `docs/architecture.md`: "Only observed changes", the active rule, the two stored fields.
- [ ] 3.2 `.claude/CLAUDE.md`: the principle, the GDACS quirks, the seeded-U.S. lines removed.
- [ ] 3.3 The published data report: the level rule, the worked example, the limits.
- [ ] 3.4 Ship and report.

---

## Log (one line per finished part: commit, deploy, tests)
- (empty)
