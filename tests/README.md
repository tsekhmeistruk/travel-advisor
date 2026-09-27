# Tests

All tests use Node's built-in runner (`node:test`). The browser tests also use `puppeteer-core` with a local Chrome or Edge. Every deploy runs `npm run test:coverage` and `npm run test:e2e`, and deploys only if both pass.

| Command | Runs | Time |
|---|---|---|
| `npm test` | unit + data tests | seconds |
| `npm run test:coverage` | the same, failing if coverage drops below **90% lines, 85% branches, 85% functions** | seconds |
| `npm run test:e2e` | browser tests (`--test-concurrency=1`) | ~2 min |
| `npm run test:all` | everything | ~2 min |
| `npm run test:e2e:headed` | browser tests in a **visible** window, slowed down (`SLOWMO=<ms>`, default 40) | ~2–3 min |

**Browser-test options** (environment variables):
- `E2E_BASE_URL=http://localhost:8080/` runs the tests against an already-running server, such as `npm start`, instead of starting their own.
- `HEADED=1` shows the browser window, and `SLOWMO=<ms>` slows it down so you can follow along.
- `CHROME_PATH` picks the browser.

The browser tests show **real scrollbars**, even headless, like Windows and Linux browsers. Headless Chrome hides them by default, and that hid a real layout bug: the panel's scrollbar made the details card overflow.

## Layout

| Folder | What goes here |
|---|---|
| `unit/pipeline/` | **Pure pipeline logic:** parsers (`us`, `ca`, `nl`, `gdacs`), build rules and the level history, text helpers.<br>**Risk layer** (`risk.test.mjs`): travel and event signals, confirmation of falls, baselines, idempotent rebuilds, event and advisory changes, source health. `events.test.mjs`: the event upsert (duplicates, revisions, missing-is-not-ended, expiry). `schedule.test.mjs`: the hourly due check, including the daily slot hour.<br>**Fetchers** (`providers.test.mjs`): run against a scripted fake request log, covering retries, Cloudflare challenges, paging, empty responses and fallbacks between sources. Waits are recorded, not slept.<br>**Infrastructure** (`infrastructure.test.mjs`): run log, storage, fetch runner and sources state, the due-check script, log summary, and the local server, including path-traversal checks. These tests write only to temp folders. |
| `unit/site/` | **Site modules that don't need a browser:** i18n, settings, data client, DOM helpers, search ranking, map splits.<br>**The travel-advisories dataset** (`dataset.test.mjs`): uses a fake provider file and real English messages, and covers styles, details cards, escaping, links, feed and search. |
| `data/` | **`data.test.mjs`:** published data equals a fresh build, and the signal state and change log already include it; the registry, manifest, records, history, risk files and translations are consistent.<br>**`project.test.mjs`:** each provider and risk source is wired up everywhere (config, module, flag, schedule, workflow); every translation key the code uses exists; the deploy gate and hourly update are intact; no secrets are committed. |
| `e2e/` | **Browser tests over the served site.** `helpers.mjs` holds the shared setup, including `withLevelChanges()`, which serves a provider's real file with level changes 1, 3, 10 and 40 days old; `site.test.mjs` covers rendering and core flows; `controls.test.mjs` covers every control, error states, accessibility, and languages (via a fake second locale). |
| `fixtures/` | **Real responses from the sources,** trimmed: `us-api.json`, `canada-feed.json`, `canada-table.html`, `netherlands-list.json`, `gdacs-search.json` (Orange and Red alerts of 30 days). Refresh a fixture only from a real response. |

## Conventions

- **Every bug fix and new behaviour gets a test.** Where possible, confirm the test fails without the fix (a mutation check).
- **Keep logic pure,** so it can be unit-tested. Inject what's slow or external (`fetch`, `sleep`, storage, the clock, the log folder) instead of calling it directly.
- **No real network in unit tests.** Tests never write into the repo; use `mkdtemp` folders.
- **Browser tests use stable hooks:** element IDs, `__data__.key` (place ID) on map elements, and CSS classes like `l1`–`l4`, `is-muted`, `is-dim`. They avoid visible text wherever the language could change it.
- **Never depend on real level changes in the deploy gate.** They are rare, so a quiet month would block deploys. Inject them with `withLevelChanges()`.
- **Screenshots** are saved to `test-output/` (git-ignored), and CI keeps them as the `screenshots` artifact.
