---
name: verify-site
description: Run the Travel Risk Map test suites (unit, data, and headless-browser tests). Use after any change to scripts/, config/, site/ (JS, CSS, HTML, i18n) or the generated data, and before pushing. The same tests gate every deploy.
---

# Verify the site

These are the same tests that `.github/workflows/deploy.yml` runs before every deploy. If they fail locally, the deploy would be blocked too.

```sh
npm ci                 # once: installs puppeteer-core (dev only; the site has no dependencies)
npm test               # unit + data tests, a few seconds
npm run test:e2e       # browser tests: serves site/ and drives headless Chrome/Edge, ~1 min
```

## What each suite covers

| Suite | Files | Checks |
|---|---|---|
| Unit | `tests/unit/pipeline/`, `tests/unit/site/` | **U.S. parsing and merging:** real API and RSS fixtures, stale copies, missing advisories, spelling variants.<br>**Canada:** table and page parsing, page-read planning.<br>**Minor-update rules, level history, name-to-place matching, build validation.**<br>**Request logging:** Cloudflare challenge detection.<br>**Site modules:** i18n and formatting, settings, data client, advisory logic, map splits, `esc` and `safeUrl`. |
| Data | `tests/data/` | **`site/data` is current:** it must equal a fresh build of `config/`, `data/snapshots/` and `data/history/`.<br>**Place registry and manifest are consistent.**<br>**Translations:** every locale has English's keys; every provider has names and levels.<br>**Every source is plausible:** ≥150 advisories, all levels present, valid dates and links.<br>**Every shape exists on the map.**<br>**Level history is well formed.**<br>**Split shapes** all exist in the place registry. |
| Browser | `tests/e2e/` | **Both sources render** at desktop and phone widths, with no console errors or horizontal scroll.<br>**Details card:** one fixed height for every country, with no overflow.<br>**Clicks select** despite small hand movement, a drag pans without selecting, and the selection outline shows above the hover outline.<br>**Source switch:** changes and persists.<br>**Search:** selects the country.<br>**Recent-update window:** filters the change feed.<br>**Search by a source's own name** ("Burma"), and a record with no place.<br>**Old saved settings** still work; no failed requests. |

- **Screenshots:** `test-output/` (git-ignored). Look at them, since layout problems don't always fail a check. In CI they're uploaded as the `screenshots` artifact.
- **Browser:** found automatically: Chrome, then Edge on Windows, or `/usr/bin/google-chrome` on the Linux CI runner. Set `CHROME_PATH` to use a different one.

## After a failure

- **"… is out of date: run `npm run build`":** config or build code changed, but the published data wasn't rebuilt. Rebuild and commit.
- **"No place for …":** a provider uses a new name. Add it to `aliases` in `config/providers/<id>.json`.
- **Card size failures:** look at `.details` and its children in `css/styles.css`. Every card uses fixed-height slots: the title is one line, the description three lines, "What changed" four lines, and the status one line.
- **A parser test failing on a fixture:** the fixtures in `tests/fixtures/` are real responses. If a source changed its format, update the parser, then refresh the fixture from a real response.
- **New behaviour or a bug fix:** add a test for it in the right suite.
