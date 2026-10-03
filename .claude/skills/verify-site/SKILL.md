---
name: verify-site
description: Run the Travel Risk Map test suites (unit, data, and headless-browser tests). Use after any change to scripts/, config/, site/ (JS, CSS, HTML, i18n) or the generated data, and before pushing. The same tests gate every deploy.
---

# Verify the site

These are the same tests that `.github/workflows/deploy.yml` runs before every deploy. If they fail locally, the deploy would be blocked too.

```sh
npm ci                 # once: installs puppeteer-core (dev only; the site has no dependencies)
npm run test:coverage  # unit + data tests with enforced coverage (what CI runs), a few seconds
npm run test:e2e       # browser tests: serves site/ and drives headless Chrome/Edge, ~2 min
```

## What each suite covers

| Suite | Files | Checks |
|---|---|---|
| Unit | `tests/unit/pipeline/`, `tests/unit/site/` | **U.S. parsing and merging:** real API fixture, stale copies, missing advisories, spelling variants, confirmed level changes.<br>**Canada:** feed and table parsing, combining the two.<br>**Netherlands:** colour codes read from Dutch summaries.<br>**Level history (the only source of pulses), name-to-place matching, build validation.**<br>**Request logging:** Cloudflare challenge detection.<br>**Site modules:** i18n and formatting, settings, data client, advisory logic, map splits, `esc` and `safeUrl`. |
| Data | `tests/data/` | **`site/data` is current:** it must equal a fresh build of `config/`, `data/snapshots/` and `data/history/`.<br>**Place registry and manifest are consistent.**<br>**Translations:** every locale has English's keys; every provider has names and levels.<br>**Every source is plausible:** ≥150 advisories, all levels present, valid dates and links.<br>**Every shape exists on the map.**<br>**The level history holds only our own observations:** every entry is `{ date, level }`, in order, none older than the first snapshot, and each record's `levelChanges` (newest first, ending at its level) and `trackedSince` are valid.<br>**Split shapes** all exist in the place registry. |
| Browser | `tests/e2e/` | **Every provider in the manifest renders** at desktop and phone widths, with injected level changes (pulses and the fullest history card), no console errors and no horizontal scroll.<br>**Details card:** one fixed height for every country, with no overflow.<br>**Clicks select** despite small hand movement, a drag pans without selecting, and the selection outline shows above the hover outline.<br>**Source switch:** changes and persists.<br>**Search:** selects the country.<br>**Level-change window:** filters the change feed (with injected level changes of known ages, `withLevelChanges()`, since real ones are rare).<br>**Search by a source's own name** ("Burma"), and a record with no place.<br>**Old saved settings** still work; no failed requests. |

- **Screenshots:** `test-output/` (git-ignored). Look at them, since layout problems don't always fail a check. In CI they're uploaded as the `screenshots` artifact. For any view of your own: `npm run shots -- 'name=#mode=highest&place=de'` (see `scripts/tools/screenshots.mjs`).
- **The full loop** (commit, deploy, live check) is the `ship-change` skill.
- **Browser:** found automatically: Chrome, then Edge on Windows, or `/usr/bin/google-chrome` on the Linux CI runner. Set `CHROME_PATH` to use a different one.

See `tests/README.md` for the full layout. In short: `tests/unit/pipeline/` holds parsers, fetchers (with scripted responses), build rules and infrastructure. `tests/unit/site/` holds the site modules and the dataset's views. `tests/data/` checks published data, config, translations, wiring, the deploy gate and secrets. `tests/e2e/site.test.mjs` and `controls.test.mjs` run in the browser.

## After a failure

- **"… is out of date: run `npm run build`":** config or build code changed, but the published data wasn't rebuilt. Rebuild and commit.
- **"No place for …":** a provider uses a new name. Add it to `aliases` in `config/providers/<id>.json`.
- **Card size failures:** look at `.details` and its children in `css/styles.css`. Every card uses fixed-height slots: the title is one line, the description three lines, the level history four lines, and the status one line.
- **A parser test failing on a fixture:** the fixtures in `tests/fixtures/` are real responses. If a source changed its format, update the parser, then refresh the fixture from a real response.
- **Coverage below threshold:** new code needs tests. Browser-only code is covered by the e2e tests instead.
- **New behaviour or a bug fix:** add a test for it in the right suite, and check that it fails without the change.
