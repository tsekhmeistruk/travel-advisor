---
name: verify-site
description: Run the Travel Risk Map test suites (unit, data, and headless-browser tests). Use after any change to scripts, js/app.js, css/styles.css, index.html or the generated data, and before pushing. The same tests gate every deploy.
---

# Verify the site

These are the same tests that `.github/workflows/deploy.yml` runs before every deploy. If they fail locally, the deploy would be blocked too.

```sh
npm ci                 # once: installs puppeteer-core (dev only; the site has no dependencies)
npm test               # unit + data tests, ~1 s
npm run test:e2e       # browser tests: headless Chrome/Edge over index.html, ~1 min
```

## What each suite covers

| Suite | Files | Checks |
|---|---|---|
| Unit | `tests/unit/` | **U.S. parsing and merging:** real API and RSS fixtures, stale copies, missing advisories, spelling variants.<br>**Canada:** table and page parsing, page-read planning.<br>**Minor-update rules, level history, build validation.**<br>**Request logging:** Cloudflare challenge detection. |
| Data | `tests/data/` | **`data/advisories.js` is current:** it must equal a fresh build of `data/sources` and `data/history.json`.<br>**Every source is plausible:** ≥150 advisories, all levels present, valid dates and links.<br>**Every shape exists on the map.**<br>**Level history is well formed.**<br>**Split lists match:** the shapes split in `js/app.js` match `SPLIT_SHAPES`. |
| Browser | `tests/e2e/` | **Both sources render** at desktop and phone widths, with no console errors or horizontal scroll.<br>**Details card:** one fixed height for every country, with no overflow.<br>**Clicks select** despite small hand movement, a drag pans without selecting, and the selection outline shows above the hover outline.<br>**Source switch:** changes and persists.<br>**Search:** selects the country.<br>**Recent-update window:** filters the change feed. |

- **Screenshots:** `test-output/` (git-ignored). Look at them, since layout problems don't always fail a check. In CI they're uploaded as the `screenshots` artifact.
- **Browser:** found automatically: Chrome, then Edge on Windows, or `/usr/bin/google-chrome` on the Linux CI runner. Set `CHROME_PATH` to use a different one.

## After a failure

- **"Out of date: run `node scripts/build-data.mjs`":** the build scripts changed but the generated data wasn't rebuilt. Rebuild and commit.
- **Card size failures:** look at `.details` and its children in `css/styles.css`. Every card uses fixed-height slots: the title is one line, the description three lines, "What changed" four lines, and the status one line.
- **A parser test failing on a fixture:** the fixtures in `tests/fixtures/` are real responses. If a source changed its format, update the parser, then refresh the fixture from a real response.
- **New behaviour or a bug fix:** add a test for it in the right suite.
