# Backend on Railway: plan and progress

> **In progress.** The live checklist of the move from GitHub Actions to a backend, approved by the owner on Oct 3, 2026. Every box is ticked as soon as its item is done (`npm run tick`), and the doc is committed with each part.
>
> **How to start or resume:**
> 1. Read this doc.
> 2. Run `git status` and `git log --oneline -10`, then `git pull` (the bot still commits until Part 7).
> 3. Continue from the first unchecked box, with the `ship-change` skill.
> 4. If a part was half done, check its working-tree changes and rerun its tests before going on.
>
> **Owner's rules:** one part = one commit, tested, pushed and deployed, before the next part starts.
>
> **What needs the owner:** Parts 0–5 need nothing from the owner: do them one after the other. Part 6 starts with the owner's Railway setup (the step list is there). Part 7 stops the bot and moves the domain: start it only when the owner has seen the shadow results and says go.

## Context (why)

Today GitHub Actions is the backend. Twice an hour `update.yml` fetches what is due, builds `site/data/`, commits it to `main`, and GitHub Pages serves static files. It works, but:

- GitHub drops scheduled runs (the hourly schedule ran about every 6 hours on Sep 27), so a 30-minute source can't run there;
- every update is a commit: 53 of the 155 commits since Sep 26 are the bot's, `.git` is 22 MB already, and every session starts with `git pull` and `merge-bot-data`;
- files can't hold what News and Air Traffic need: many rows, asked for by place and time.

The owner (Oct 3, 2026) wants: a backend that calls the sources itself, a fast database, room for a News section and an Air Traffic section (calls every 30 minutes), on the Railway Hobby plan ($5), on a .com domain already bought.

**Outcome:** one Node service on Railway fetches, builds and serves. GitHub keeps code, config and tests. The site's own code doesn't change: the backend serves the same JSON at the same paths.

**The owner's decisions (Oct 3, 2026):**
- **Database:** SQLite inside the backend (not Postgres).
- **Hosting:** the backend serves site and data on Railway; Cloudflare (free) sits in front of the .com.
- **The switch:** a shadow run of about 3 days first.
- **History and backups:** a daily export to a public `data` branch.
- **Then:** save the detailed plan, clear the context, implement in auto mode.

## Is Railway Hobby ($5) enough? Yes

Railway's prices (docs.railway.com, read Oct 3, 2026): Hobby is $5 a month and includes $5 of usage; above that only the difference is billed. RAM $10 per GB a month, CPU $20 per vCPU a month, volume $0.15 per GB a month (only what is used), traffic out $0.05 per GB. Hobby allows a 5 GB volume; its RAM and CPU limits are far above our needs.

| | Assumption | $ a month |
|---|---|---|
| RAM | the server, about 90 MB all the time; the update job, about 150 MB for seconds, ~50 times a day | ~1.0 |
| CPU | an idle server, ~50 builds a day of 0.5 s (measured) | ~0.1 |
| Volume | under 1 GB (the state is 6.6 MB today) | < 0.15 |
| Traffic | ~0.6 MB per first visit = $0.03 per 1,000 visits; near 0 behind Cloudflare | < 0.5 |
| **Total** | | **about $1.5–2** |

Air Traffic every 30 minutes adds cents; News adds a few hundred MB of storage. The RAM and CPU rows are estimates: item 6.5 checks them against Railway's metrics before the switch.

## Target

```
visitor ─► Cloudflare (DNS, cache) ─► Railway: one Node service
                                       ├─ HTTP       site/ (static) · /data/* (documents) · /api/* (later)
                                       │             /health · /status · /admin/* (token)
                                       ├─ scheduler  every 5 min: what is due? → update job (child process)
                                       │             fetch → build → validate → publish (one transaction)
                                       └─ SQLite     a file on the volume: state, changes, fetch runs, documents

GitHub: code, config, tests. Push → tests pass → Railway deploys. Daily: export → `data` branch.
```

## Status

- **Current step:** 1.1
- **Done:** Part 0
- **Last commit of this revision:** none

## Every part ends with the same checks

- `npm run test:coverage` (the 90/85/85 thresholds hold with the new files) and `npm run test:e2e`: all green.
- `npm run build`, then `git diff --stat site/data data`: empty, unless the part says the output changes. No part before 7 may change what the build makes.
- Parts 1–5 change nothing a visitor sees, so no screenshots; a quick `npm run live-check` after the deploy.
- Commit with this doc's boxes ticked; `npm run merge-bot-data` if the bot committed (until Part 7); push; `gh run watch` the deploy until green.
- Update `docs/architecture.md` and the map of the code in `.claude/CLAUDE.md` for what the part adds.
- Record the tests added, edited and deleted in the Log.

## What was found (so it isn't looked up again)

**The code's seams**
- `FileStore` (`scripts/lib/store.mjs`) is synchronous and is the only file access of the pipeline, with two exceptions: `scripts/lib/fetch-log.mjs` appends to `logs/fetch/<yyyy>/<yyyy-mm>.jsonl` itself (`LOG_ROOT`, `logFile()`), and `scripts/lib/log-summary.mjs` reads those files and `site/data/risk/health.json` itself.
- A store is created in `scripts/fetch.mjs` (default argument of `runFetch()`), `scripts/build.mjs` (twice), `scripts/due.mjs`, and in the tests `tests/data/project.test.mjs`, `tests/data/data.test.mjs`, `tests/unit/pipeline/infrastructure.test.mjs` (five times). `store.path()` is used only inside the store.
- `FileStore`'s methods: config `places`, `dataset`, `provider`, `datasetIds`, `categories`, `source`, `sourceIds`, `schedule`; state `snapshot`/`saveSnapshot`, `history`/`saveHistory`, `events`/`saveEvents`, `archiveEvents`, `counts`/`saveCounts`, `conflictVersions`, `conflict`, `saveConflictVersion`, `context`/`saveContext`, `signals`/`saveSignals`, `changes(year)`/`appendChanges`, `sourcesState`/`saveSourcesState`; site `geo`, `locales`, `locale`, `publish`, `published`. Missing data is `null`, except `history()` and `sourcesState()` (`{}`) and `changes()` (`[]`).
- `runFetch()` never throws; `withRunLog()` sets `process.exitCode = 1` on a failure. `currentRun()` reads `GITHUB_RUN_ID`, and the log's `trigger` reads `GITHUB_EVENT_NAME`.
- `readBuildInput()` reads the change logs of this year and the last by the wall clock (`new Date().getUTCFullYear()`). `buildAll()` is pure. The CLI block of `scripts/build.mjs` writes: `publish` each file, `saveHistory`, `saveSignals`, `appendChanges`.
- `dueSources()` (`scripts/lib/schedule.mjs`): `TOLERANCE_MINUTES = 10`, `SLOT_HOURS = 22`, returns `{ due, jitter, reasons }`. `runDue()` (`scripts/due.mjs`) reads `EVENT`, `SEED`, `SOURCES` and writes `$GITHUB_OUTPUT`. `update.yml` uses both until Part 7, so they must keep working until then. Tests use the seed `tsekhmeistruk/travel-advisor` (`schedule.test.mjs`, `infrastructure.test.mjs`).
- `update.yml` fetches in this order: gdacs, who, gdelt, ucdp, wikipedia, usgs, eonet, a random wait of 0–39 minutes (on-time daily run only), us, ca, nl, uk, de; then build, summary, commit, deploy.
- `serve(port)` (`scripts/serve.mjs`) returns `{ server, url }`, listens on 127.0.0.1, sends `Cache-Control: no-store`, and is used by `tests/e2e/helpers.mjs` and `scripts/tools/screenshots.mjs`. The site asks for `data/…` relative to the page (`createDataClient()` in `site/js/main.js`), and the browser tests match data by path (`isData()`: the pathname ends with `/data/<path>`).
- `tests/data/project.test.mjs` asserts, per id, a fetch step in `update.yml` (`assertInWorkflow()`), and that `update.yml` calls `deploy.yml`.
- `buildRisk()` takes its "now" from the newest fetch and attempt in its inputs, and uses `config/schedule.json` for source health.
- "github.io" is hard-coded only in `README.md`, `.claude/CLAUDE.md` and `scripts/tools/live-check.mjs` (its default `--base`).

**Measured (Oct 3, 2026)**
- A full build: 0.17 s to read, 0.33 s to build, 268 files, 876 KB minified, about 150 MB of memory for a one-shot process.
- `data/` is 6.6 MB (5.5 MB of it UCDP's versions); `site/data/` is 2.06 MB in 270 files (0.48 MB gzipped; 254 are place files); the site's code is 0.59 MB (0.19 MB gzipped).
- Node here is 24.11.0. `node:sqlite` works (SQLite 3.50.4, FTS5 present) and prints an `ExperimentalWarning`. CI runs Node 22 (`deploy.yml`, `update.yml`); `package.json` says `>=22`.
- Docker 24.0.7 is installed here. The Railway CLI is not.

**Railway (docs.railway.com, Oct 3, 2026)**
- **Volumes:** 5 GB on Hobby; one per service; none with replicas; not shared between services; a redeploy of a service with a volume has a short downtime ("we prevent multiple deployments from being active and mounted to the same service").
- **Volume backups:** daily (kept 6 days), weekly (27 days), monthly (89 days); restored only into the same project; wiping a volume deletes them. Which plans have them isn't stated: look in the dashboard.
- **"Wait for CI":** Railway waits for every GitHub Actions check suite on the commit; a failed one skips the deploy. The workflow must have `on: push: branches: [main]` (`deploy.yml` has).
- **Domains:** a root domain needs a DNS provider with ALIAS or CNAME flattening (Cloudflare has). Behind Cloudflare's proxy Railway serves its `*.up.railway.app` certificate, so Cloudflare's SSL mode is Full.
- **Cron services** exist (5 minutes apart at least) but aren't used: a volume can't be shared with them.
- **To check when writing the files** (not read yet): the keys of `railway.json` (`watchPatterns`, `healthcheckPath`, `restartPolicyType`), and that volumes mount as root (a non-root image needs `RAILWAY_RUN_UID=0`).

**Cloudflare:** honours `stale-while-revalidate` and `stale-if-error` (on 5xx) from the origin, unless Always Online is on. JSON and HTML aren't cached by default: a Cache Rule is needed (to check at 7.2).

**OpenSky** (an example for Air Traffic): the whole world is one request of 4 credits; 400 credits a day without an account, 4,000 with one; OAuth2 client credentials.

## The design

### The store

- **`SqliteStore`** (`scripts/lib/sqlite-store.mjs`) has every method of `FileStore`. Config methods (`places` … `schedule`, `geo`, `locales`, `locale`) go to an inner `FileStore`: config stays in git. State and published data go to SQLite.
- **`node:sqlite` is loaded in the constructor** with `process.getBuiltinModule('node:sqlite')`, so a run on files never loads it (no warning in `npm run build`). `DatabaseSync` is synchronous: `exec`, `prepare(sql).get/all/run`. Pragmas: `journal_mode = WAL` (not for `:memory:`), `synchronous = NORMAL`, `busy_timeout = 5000`.
- **`createStore()`** (in `scripts/lib/store.mjs`) returns a `SqliteStore` when `DB_PATH` is set, else a `FileStore`. `fetch.mjs`, `build.mjs` and `due.mjs` call it.
- **New on both stores:** `transaction(fn)`, `publishAll(files)` (SQLite also removes documents the build no longer makes), `appendFetchRun(entry)`, `fetchRuns({ since })`, and what the import needs to list: `changeYears()`, `archivedEvents(source)`, `publishedPaths()` (without `geo/`).

```sql
CREATE TABLE state (key TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL) WITHOUT ROWID;
  -- keys: snapshot/<dataset>/<provider> · history/<dataset> · events/<source> · counts/<source> (also <source>-pairs)
  --       conflict/<source>/<version> · context/<source> · signals · sources-state
CREATE TABLE changes (seq INTEGER PRIMARY KEY, id TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL);         -- append-only, read by year in seq order
CREATE INDEX changes_at ON changes (at);
CREATE TABLE archived_events (seq INTEGER PRIMARY KEY, source TEXT NOT NULL, year TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE fetch_runs (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, source TEXT NOT NULL, result TEXT NOT NULL, duration_ms INTEGER, body TEXT NOT NULL);
CREATE INDEX fetch_runs_time ON fetch_runs (time);
CREATE TABLE documents (path TEXT PRIMARY KEY, body TEXT NOT NULL, gzip BLOB NOT NULL, etag TEXT NOT NULL, updated_at TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;   -- lastBuild, lastExport, seeded
PRAGMA user_version = 1;   -- migrations go by this number
```

- **Documents first.** The pure logic reads whole documents, so they move as they are, one row per today's file. `conflictVersions()` sorts as `FileStore` does (numeric: 24.0.9 before 24.0.10). A document row is rewritten only when its body differs, so its ETag holds. Bodies are minified JSON.
- **Real tables** are for append-only data now, and for News and Air Traffic later.

### Import and export

- **`importFiles({ from, to })`** (`scripts/tools/import-files.mjs`) copies everything a `FileStore` has into another store in one transaction: snapshots, histories, each source's data by its kind, signals, changes of every year, archived events, sources state, fetch runs, published files.
- **`exportFiles({ from, to })`** is the same the other way; `FileStore` writes its usual formats, so the files diff by line as now.
- **`npm run data:pull`** (`scripts/tools/pull-data.mjs --base <url> [--out <dir>]`, token in `ADMIN_TOKEN`) downloads `/admin/export`, opens it as a `SqliteStore` and exports to files. It refreshes the local seed, and the backup workflow uses it.

### The update job

`scripts/update.mjs` is what `update.yml` does today, as one script. `runUpdate({ store, ids, buildOnly, now })`:

1. No ids: ask `dueSources()`. With ids (`node scripts/update.mjs gdacs usgs`): fetch those, due or not. `--build`: fetch nothing.
2. `runFetch()` for each id, one after the other: the sources, then the advisory providers.
3. If anything was fetched, or `--build`: `readBuildInput(store)`, `buildAll()`.
4. `problems` (a name it can't place) or a failed `validatePublish()`: write nothing, record the reason in `meta.lastBuild`, exit with a code.
5. Else `publishBuild()` in one `store.transaction()`: `publishAll`, `saveHistory`, `saveSignals`, `appendChanges`, `meta.lastBuild`. `publishBuild()` is the write half of `scripts/build.mjs`'s CLI block, moved into a function that both use.

**`validatePublish(files, previous)`** (`scripts/lib/validate.mjs`, pure) returns a list of errors. It holds the checks of `tests/data/data.test.mjs` that guard against a bad fetch, and that test calls it too, so the two can't drift: the manifest names every provider and risk file; each provider's record count is at least 80% of the last published one; every place id is known; every level is on the scale.

### The schedule

The scheduler ticks every 5 minutes; GitHub's ran every 30. `dueSources()` gets an option for that (`precise`), and the old path stays until Part 8 because `update.yml` uses it:

- **Retry spacing:** a source whose last attempt failed isn't tried again for 30 minutes. Without it the rate-limited U.S. API would be called every 5 minutes.
- **The slot minute:** a daily source is due from a pseudo-random minute of the day (`slotMinute(day, seed)` beside `slotHour()`), so nothing sleeps 0–39 minutes and holds the build back.
- **Tolerance** of 2 minutes instead of 10, so an hourly source runs hourly.
- **The backend's seed** is its own (`risk-monitor`), so during the shadow run it calls the U.S. API in another hour than the bot.

A new section is then one line in `config/schedule.json` (`{ "everyMinutes": 30 }`), with no workflow step.

### The server

`server/app.mjs` exports the request handler, built from injected parts (the store, the site folder, the clock, the token), so it is unit-tested without a port.

| Route | Answer |
|---|---|
| `GET /data/<path>` | the document from the store: stored gzip if accepted, `ETag`, `304` on a match. `geo/` and anything not a document fall through to static. |
| `GET /…` | a file of `site/` (never outside it, as `serve.mjs` checks today). |
| `GET /health` | 200 when the process runs and the store reads. For Railway's health check. |
| `GET /status` | JSON: the last build, each source's status (`risk/health.json`), the last tick and the last export. **503** when the last build failed, a source is in `error`, the scheduler hasn't ticked for 15 minutes, or the last export is over 3 days old. For the uptime monitor. |
| `POST /admin/update?sources=…` | queues a manual run (`all`, `due`, or ids). Replaces `gh workflow run update.yml`. |
| `GET /admin/fetches?days=7` | the Fetch results table (`scripts/lib/log-summary.mjs`). |
| `GET /admin/export` | a consistent copy of the database (`VACUUM INTO`), gzipped. |

`/admin/*` needs `Authorization: Bearer <ADMIN_TOKEN>` (compared in constant time); without the variable set they answer 404.

| What | `Cache-Control` in production |
|---|---|
| `/data/*` asked with `?v=` | `public, max-age=31536000, immutable` |
| `/data/*` without `?v=` (the manifest) | `public, max-age=0, s-maxage=60, stale-while-revalidate=600, stale-if-error=86400` |
| `index.html`, `js/`, `css/`, `i18n/` | `public, max-age=0, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400` |
| `vendor/`, `assets/`, `data/geo/` | `public, max-age=86400, stale-while-revalidate=604800` |

- **`scripts/serve.mjs` becomes this app over the files,** with today's behaviour kept: 127.0.0.1, `no-store`, port 0 for tests. So `npm start`, the browser tests and `npm run shots` use the real request path.
- **`server/scheduler.mjs`:** the tick, one job at a time (a tick while a job runs is skipped), the manual queue first, a 20-minute limit (SIGTERM, then SIGKILL), with the clock, the timer and `spawn` injected. The job is a child process (`node scripts/update.mjs`), so a parser crash or a memory spike can't take the site down and a build never blocks a request.
- **`server/main.mjs`** (kept tiny): open the store, migrate, seed from the image's files if the database is empty, listen on `0.0.0.0:$PORT`, run one build (`update.mjs --build`, so a code or config change shows at once; builds are idempotent), start the scheduler. On SIGTERM: stop the scheduler, stop the job, close. `SCHEDULER=off` starts no scheduler (local runs and tests must not call the sources).
- **The server only reads the database after start;** the job writes. WAL lets both work on the one file.

### Data in git, backups

- `data/`, `site/data/` and `logs/` stay in `main` as a **frozen seed and test fixture**: the data test (a golden-file test of the build) and the browser tests keep running on them. `npm run data:pull` refreshes them when wanted.
- `.github/workflows/backup.yml`, daily: `pull-data` into a checkout of the `data` branch, commit, push. An off-site backup and a public history. The level history exists only in what we observed: a lost database can't be fetched again.
- Restore: `import-files` from a checkout of the `data` branch.

---

## Part 0: Set up

- [x] 0.1 This doc as `docs/plans/backend.md`, linked from "Current state" in `.claude/CLAUDE.md`. Commit and push.

## Part 1: The store on SQLite

- [ ] 1.1 `scripts/lib/sqlite-store.mjs`: `SqliteStore` with the schema above and every `FileStore` method.
- [ ] 1.2 `transaction()`, `publishAll()`, `changeYears()`, `archivedEvents()`, `publishedPaths()` on both stores; `createStore()`; `fetch.mjs`, `build.mjs`, `due.mjs` use it.
- [ ] 1.3 Node 24: `engines` in `package.json`, `node-version` in `deploy.yml` and `update.yml`.
- [ ] 1.4 Tests.
  - [ ] added: one contract suite run on both stores (`tests/unit/pipeline/store.test.mjs`): every method, missing data, the order of versions and changes
  - [ ] added: SQLite only: a transaction that throws writes nothing; `publishAll` removes a dropped document; an unchanged document keeps its ETag; a second open of the same file reads what the first wrote
  - [ ] edited: the store tests in `infrastructure.test.mjs` move into the contract suite
- [ ] 1.5 Ship.

## Part 2: Fetch runs through the store, import and export

- [ ] 2.1 `scripts/lib/fetch-log.mjs` writes with `store.appendFetchRun()` (the `root` option keeps working for tests); the run id and trigger come from `RUN_ID` and `RUN_TRIGGER`, then GitHub's variables, then `local`. `runFetch()` passes its store.
- [ ] 2.2 `scripts/lib/log-summary.mjs` reads runs with `store.fetchRuns()` and health with `store.published()`.
- [ ] 2.3 `scripts/tools/import-files.mjs` and `scripts/tools/pull-data.mjs` (`importFiles`, `exportFiles`); `npm run data:import`, `npm run data:pull`.
- [ ] 2.4 Tests.
  - [ ] added: **a build from the imported database equals a build from the files** (the whole repo's data into `:memory:`)
  - [ ] added: import then export gives the same files, byte for byte, in a temporary folder
  - [ ] edited: `fetch-log.test.mjs` and the log-summary tests run on both stores
- [ ] 2.5 Ship.

## Part 3: The update job, validation, the schedule

- [ ] 3.1 `publishBuild()` in `scripts/build.mjs`, used by its CLI block.
- [ ] 3.2 `scripts/lib/validate.mjs` (`validatePublish()`); `tests/data/data.test.mjs` calls it on the committed data.
- [ ] 3.3 `scripts/update.mjs` (`runUpdate()`), `npm run update`.
- [ ] 3.4 `scripts/lib/schedule.mjs`: `precise` (retry spacing, `slotMinute()`, a 2-minute tolerance). The old path, `jitter` and `due.mjs`'s GitHub outputs stay for `update.yml`.
- [ ] 3.5 `readBuildInput()` takes the year from the data's newest fetch, not from the wall clock (a frozen seed must build the same next year).
- [ ] 3.6 Tests.
  - [ ] added: `runUpdate()` with fake fetchers: due only, given ids, `--build`; a failed fetch still builds; problems and validation errors publish nothing and are recorded; a build is one transaction
  - [ ] added: each rule of `validatePublish()`, and that the committed data passes
  - [ ] added: retry spacing, the slot minute, the tolerance (`schedule.test.mjs`)
  - [ ] edited: none of the old schedule tests change (the old path stays)
- [ ] 3.7 Ship.

## Part 4: The server and the scheduler

- [ ] 4.1 `server/app.mjs`: the routes and headers above.
- [ ] 4.2 `scripts/serve.mjs` uses it over the files, with the same `serve(port)`.
- [ ] 4.3 `server/scheduler.mjs` and `server/main.mjs`; `npm run backend`.
- [ ] 4.4 Tests.
  - [ ] added: `tests/unit/pipeline/server.test.mjs`: documents (gzip, ETag, 304, `?v=`), static files, path traversal (moved from `infrastructure.test.mjs`), the cache headers, `/health`, `/status` in each failing state, `/admin/*` with a good, a wrong and no token, 503 for a document before the first publish
  - [ ] added: `tests/unit/pipeline/scheduler.test.mjs`: nothing due, a due run, a tick during a job, the manual queue, the time limit, a stop
  - [ ] added: e2e `tests/e2e/backend.test.mjs`: the app over a seeded SQLite file serves the page with no console error, and a selected place loads its file
  - [ ] edited: the `serve()` tests in `infrastructure.test.mjs`
- [ ] 4.5 Ship.

## Part 5: The container

- [ ] 5.1 `Dockerfile` (`node:24-slim`; copies `package.json`, `config`, `scripts`, `server`, `site`, `data`, `logs`; no `npm ci`, there are no runtime dependencies; `CMD node --disable-warning=ExperimentalWarning server/main.mjs`) and `.dockerignore`.
- [ ] 5.2 `railway.json`: the Dockerfile builder, the health check on `/health`, restart on failure, and **watch paths that leave out `data/`, `logs/` and `site/data/` except `geo/`**, so the bot's hourly commits (and docs-only commits) don't redeploy the backend.
- [ ] 5.3 Checked here in Docker, with `SCHEDULER=off`, a named volume and `ADMIN_TOKEN=test`:
  - [ ] the first start seeds; a second start doesn't; `/data/manifest.json` equals the repo's
  - [ ] `E2E_BASE_URL=http://localhost:8080/ npm run test:e2e` passes against the container
  - [ ] `POST /admin/update?sources=gdacs` fetches and publishes (GDACS isn't rate-limited; never `us` here), and `/admin/fetches` shows the run
  - [ ] `npm run data:pull -- --base http://localhost:8080 --out <temp>` gives files a build accepts
- [ ] 5.4 Tests: `tests/data/project.test.mjs` asserts the container's wiring (the start command exists, the watch paths leave the data out).
- [ ] 5.5 Ship.

## Part 6: Railway, in shadow (the live site doesn't change)

**The owner's steps** (the dashboard; or install the Railway CLI and log in, and they are run from here):
1. New project → Deploy from GitHub repo → `tsekhmeistruk/travel-advisor`, branch `main`.
2. The service → Settings: turn on "Wait for CI".
3. Add a volume to the service, mounted at `/db`.
4. Variables: `DB_PATH=/db/risk.db`, `ADMIN_TOKEN=<a long random string>`.
5. Networking → Generate Domain (the `*.up.railway.app` address).
6. Usage: an alert at $5.
7. In GitHub → Settings → Secrets and variables → Actions: the secret `ADMIN_TOKEN` (the same string) and the variable `BACKEND_URL` (the address from step 5). Tell the session the address.

- [ ] 6.1 The owner's steps are done; the first deploy seeded itself (`/status` is 200, `/data/manifest.json` answers).
- [ ] 6.2 `scripts/tools/shadow-diff.mjs` (`npm run shadow-diff`): the backend's `/data/` against the live site's: each provider's records and levels, `risk/current.json` levels, event ids and levels, the conflict version, and changes as (place, category, from, to, day). Times and ids built from fetch times are left out: the two fetch at different moments.
- [ ] 6.3 `.github/workflows/backup.yml`: daily and by hand, `pull-data` into the `data` branch (made on the first run), commit, push.
- [ ] 6.4 Tests: `shadow-diff`'s comparison (pure, unit); `project.test.mjs` asserts the backup workflow.
- [ ] 6.5 The shadow run, about 3 days. Each day: `npm run shadow-diff` and `/admin/fetches`. Record in the Log:
  - [ ] every source fetched from Railway's addresses (the U.S. API and travel.gc.ca above all)
  - [ ] differences explained (fetch times only), or fixed
  - [ ] memory, CPU and a day's cost from Railway's metrics (× 30 under $5)
  - [ ] how long a deploy's restart takes
  - [ ] the first backup commit on the `data` branch
- [ ] 6.6 Ship, and report the shadow results to the owner.

## Part 7: The switch (only when the owner says go)

**The owner's steps:** a Cloudflare account; add the domain; point the registrar's nameservers at Cloudflare; in Railway add the custom domain and give the CNAME target; sign up for a free uptime monitor on `https://<domain>/status`.

- [ ] 7.1 Stop the bot: remove `schedule:` from `update.yml` (keep `workflow_dispatch` as the way back), wait for a running update to end, `git pull`. Then the owner wipes the volume and deploys the latest commit: the first start seeds from the bot's last state, so nothing observed is lost. Check `/data/manifest.json` against the repo's before the first fetch.
- [ ] 7.2 The domain: a proxied CNAME for the root (flattened) to Railway; SSL mode Full; Always Online off; a Cache Rule so the host's JSON and HTML are cached by the origin's headers; `www` redirects to the root. `BACKEND_URL` becomes the domain.
- [ ] 7.3 `deploy.yml` becomes tests only, plus a GitHub Pages deploy of `redirect/index.html`: a small page that sends the old address to the new one and keeps `location.search` and `location.hash`. (Saved settings don't follow to the new domain: accepted.)
- [ ] 7.4 `scripts/tools/live-check.mjs`'s default address, `README.md`, the fetchers' `User-Agent` contact.
- [ ] 7.5 Tests: `project.test.mjs` (the test workflow runs both suites on a push to `main`; the redirect page keeps the hash); e2e of the redirect page.
- [ ] 7.6 Verify: `npm run live-check` on the new domain; the old address redirects with its `#…`; `/status` is 200; a restart during a deploy isn't seen through Cloudflare; the next scheduled fetch shows in `/admin/fetches`.
- [ ] 7.7 Ship.

**The way back,** if the backend misbehaves: put `schedule:` back in `update.yml`, `npm run data:pull` and commit (so the bot continues from the backend's state), and point the domain at GitHub Pages.

## Part 8: Clean up

- [ ] 8.1 Delete `update.yml`, `scripts/tools/merge-bot-data.mjs` (and `npm run merge-bot-data`), the old path of `dueSources()` with `jitter`, and `due.mjs`'s GitHub outputs.
- [ ] 8.2 Run both suites once with the clock 60 days ahead: no test may depend on the seed's age. Fix what does by injecting the time.
- [ ] 8.3 Docs: `docs/architecture.md` (the data flow; "Moving to a database" becomes "The backend"; adding a provider or a source loses its workflow step), `README.md`, `.claude/CLAUDE.md` (no bot, the live address, the backend's gotchas, "Current state"), `.claude/skills/ship-change/SKILL.md` (no bot merge; the deploy is Railway's; a manual update is `/admin/update`), `tests/README.md`, `logs/README.md`.
- [ ] 8.4 Tests: deleted: the merge-bot-data tests, `assertInWorkflow()`'s workflow checks, the `jitter` and GitHub-output tests; edited: `project.test.mjs` (every scheduled id has a module and every module is scheduled).
- [ ] 8.5 Ship.

---

## Room for News and Air Traffic (not built here)

A section is: a fetcher in `scripts/providers/<id>/` (network in `index.mjs`, pure `parse.mjs`, as now), a line in `config/schedule.json`, its tables (a schema migration), its endpoint under `/api/`, and a mode in `site/js/datasets/`.

- **Air Traffic, every 30 minutes.** With OpenSky: 48 requests a day cost 192 credits. Keep counts per place and half hour (`air_counts`, about 4 million small rows a year) and the latest snapshot as one document for the map. Don't keep raw snapshots: about 2 MB each is 3 GB a month, more than the volume. Counts against each place's normal reuse `scripts/lib/anomaly.mjs`.
- **News.** `news_items` with FTS5 for search, served in pages by `/api/news?place=…&before=…`, not as one big file. Keep 90 days.
- **The AI chat** (designed, not built) can live in this backend instead of a Cloudflare Worker.

## Risks

| Risk | Answer |
|---|---|
| A source refuses Railway's addresses (the U.S. API behind Cloudflare, travel.gc.ca) | Found in the shadow run (6.5). Fallback: that one fetcher stays in a GitHub Action and posts its result to the backend. |
| The database is lost | The daily export to the `data` branch; restore with `import-files`. `/status` goes 503 when the export is over 3 days old. |
| Bad data goes live without the test gate | `validatePublish()`, one transaction, the last good set stays, `/status` 503 → an alert. |
| Downtime on each deploy (the volume) | Cloudflare serves cached and stale copies; the watch paths skip data and docs commits; measured in 6.5. |
| `node:sqlite` is experimental | Node pinned to 24; the driver in one file, where `better-sqlite3` could replace it. |
| A stuck fetch blocks the schedule | The job's 20-minute limit; `/status` goes 503 when the scheduler stops ticking. |
| The bot's commits redeploy the backend every hour | The watch paths in `railway.json` (5.2). |
| A local run calls the rate-limited U.S. API | `SCHEDULER=off` locally and in tests; manual updates only with `gdacs`. |
| Cost creeps past $5 | The usage alert; only the difference is billed. |

## Still open (what is assumed until the owner says otherwise)

1. **Alerts:** a free uptime monitor on `/status` that emails the owner (no code). The alternatives are a GitHub issue or Telegram.
2. **Railway access:** the owner clicks through the dashboard from the lists in Parts 6 and 7; with the Railway CLI installed and logged in, the steps are run from here.
3. **The domain:** its name and its registrar are needed at 7.2, not before.
4. **Air Traffic:** which API, and what the section shows (planes now, counts per country, closed airspace).
5. **News:** which sources.

## Log (one line per finished part: commit, deploy, checks, and the tests added, edited and deleted)
- Part 0: the plan saved in the repo and linked from CLAUDE.md (docs only). Tests added, edited, deleted: none.
