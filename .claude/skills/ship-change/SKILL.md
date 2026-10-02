---
name: ship-change
description: The owner's full loop for a change to the Risk Monitor, from code to a verified live deploy, with a checklist for multi-part work. Use when implementing any planned change or a part of a plan, and to resume an interrupted plan (docs/plans/*.md).
---

# Ship a change

The owner expects: implement → test → screenshots → commit → push → watch the deploy → live check → report. One part of a plan = one commit, shipped before the next part starts.

## 0. Before starting

- `git status` must be clean: commit anything left over first. Then `git pull` (a bot commits data up to every hour).
- **Multi-part work runs from a checklist** in `docs/plans/<name>.md`, linked from "Current state" in `.claude/CLAUDE.md`. The format (see `docs/plans/ux-revision-2.md`):
  - `- [ ] 1.2 …` items per step, with sub-items for each test;
  - a **Status** block (current step, done, last commit);
  - a **Log** with one line per finished part: commit, deploy, live check, and the tests added, edited and deleted.
- Tick each box **as soon as its item is done**, with `npm run tick -- docs/plans/<name>.md 1.1,1.2 --sub "e2e: …" --current 1.3 --done "…" --last "<sha>" --log "…"`. Commit the doc with each part.
- **Resuming:** read the checklist first, `git status`, `git log --oneline -10`, then continue from the first unchecked box. Rerun the tests of a half-done part before going on.

## 1. Implement

- Follow `.claude/CLAUDE.md` (conventions, map of the code) and `docs/architecture.md`.
- Write code with the Write and Edit tools. For many edits, use an edit script in the session scratchpad run with `node`. Never pass code through bash heredocs or `node -e "…"`: they eat backslashes and `$(…)`/`$('id')`.
- Every change: decide which tests to **add, edit or delete** (see "Every change: review the tests too" in CLAUDE.md). A bug fix gets a test that fails without the fix: check it, e.g. with `git stash` of the fix.

## 2. Test

```sh
npm run test:coverage   # unit + data, 90/85/85 coverage (seconds)
npm run test:e2e        # browser tests (~3 min); one file: node --test tests/e2e/risk.test.mjs
```

After config or build-code changes, run `npm run build`; the data test compares the published data with a fresh build.

## 3. Look at it

```sh
npm run shots                                   # every mode, 1440 light + 390 dark
npm run shots -- 'name=#mode=highest&place=de' --phone --dark --full --hover mx --stored '{"mode":"travel"}'
```

Files go to `test-output/shots/`; read the PNGs. Check both themes and phone width. Layout bugs often pass the tests.

## 4. Commit and deploy

```sh
git add -A && git commit        # message: what and why, then the tests added/edited/deleted
git fetch && git log HEAD..origin/main --oneline   # the bot committed? then:
npm run merge-bot-data          # merges and settles log/state/site-data conflicts, rebuilds
git push
"C:/Program Files/GitHub CLI/gh.exe" run list --workflow deploy.yml --limit 1   # then gh run watch <id> --exit-status
```

The deploy runs all the tests again. After a **pipeline** change, also run one update: `gh workflow run update.yml --ref main -f sources=gdacs`, then watch it and `git pull`. Never use `sources=all` repeatedly: it calls the rate-limited U.S. API.

## 5. Live check and report

```sh
npm run live-check -- '#mode=highest&place=de'   # every mode: console errors, header, card, feed, zoom
```

Tick the part's ship box and add its log line. Stop any server you started. Report each part to the owner: what changed, the live check, and the tests added, edited and deleted.
