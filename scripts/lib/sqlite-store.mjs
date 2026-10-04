// The pipeline's storage on SQLite (node:sqlite), with every method of FileStore (store.mjs).
// Configuration stays in git and is read through an inner FileStore; pipeline state and the
// published data are rows of one database file. Documents move as they are (one row per
// file of the FileStore); real tables hold what is append-only: changes, archived events,
// fetch runs. See docs/plans/backend.md for the design.

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { FileStore, ROOT } from './store.mjs';

/** The schema by version: MIGRATIONS[n] takes a database from version n to n + 1. */
const MIGRATIONS = [`
  CREATE TABLE state (key TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE changes (seq INTEGER PRIMARY KEY, id TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL);
  CREATE INDEX changes_at ON changes (at);
  CREATE TABLE archived_events (seq INTEGER PRIMARY KEY, source TEXT NOT NULL, year TEXT NOT NULL, body TEXT NOT NULL);
  CREATE TABLE fetch_runs (seq INTEGER PRIMARY KEY, time TEXT NOT NULL, source TEXT NOT NULL, result TEXT NOT NULL, duration_ms INTEGER, body TEXT NOT NULL);
  CREATE INDEX fetch_runs_time ON fetch_runs (time);
  CREATE TABLE documents (path TEXT PRIMARY KEY, body TEXT NOT NULL, gzip BLOB NOT NULL, etag TEXT NOT NULL, updated_at TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
`];

const byVersion = (a, b) => a.localeCompare(b, 'en', { numeric: true });   // 24.0.9 before 24.0.10
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
const isTable = (v) => v !== null && typeof v === 'object';

export class SqliteStore {
  #db;
  #files;
  #now;
  #depth = 0;
  #statements = new Map();

  /**
   * @param file  the database file, or ':memory:'
   * @param opts.root  the repo (configuration is read from its files)
   * @param opts.now  the clock, for the rows' updated_at
   */
  constructor(file, { root = ROOT, now = () => new Date() } = {}) {
    // Loaded here, not imported: a run on files never loads node:sqlite (it prints an ExperimentalWarning).
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    this.#db = new DatabaseSync(file);
    this.#files = new FileStore(root);
    this.#now = now;
    if (file !== ':memory:') this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000');
    try {
      this.#migrate();
    } catch (err) {
      this.#db.close();   // a constructor that throws must not keep the file open
      throw err;
    }
  }

  close() { this.#statements.clear(); this.#db.close(); }

  /** Everything `fn` writes, or nothing if it throws. A transaction inside another joins it. */
  transaction(fn) {
    if (this.#depth) return fn();
    this.#db.exec('BEGIN IMMEDIATE');
    this.#depth++;
    try {
      const result = fn();
      this.#db.exec('COMMIT');
      return result;
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    } finally {
      this.#depth--;
    }
  }

  /** Notes of the backend about itself (the `meta` table): lastBuild, lastExport, seeded. */
  meta(key) {
    const row = this.#sql('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  }
  saveMeta(key, value) {
    this.#sql('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  // ---- configuration (in git, read from the files)
  places() { return this.#files.places(); }
  dataset(id) { return this.#files.dataset(id); }
  provider(id) { return this.#files.provider(id); }
  datasetIds() { return this.#files.datasetIds(); }
  categories() { return this.#files.categories(); }
  source(id) { return this.#files.source(id); }
  sourceIds() { return this.#files.sourceIds(); }
  schedule() { return this.#files.schedule(); }
  geo() { return this.#files.geo(); }
  locales() { return this.#files.locales(); }
  locale(code) { return this.#files.locale(code); }

  // ---- pipeline state (the `state` table, one row per document)
  snapshot(dataset, provider) { return this.#state(`snapshot/${dataset}/${provider}`); }
  saveSnapshot(dataset, provider, snapshot) { this.#saveState(`snapshot/${dataset}/${provider}`, snapshot); }

  history(dataset) { return this.#state(`history/${dataset}`) ?? {}; }
  saveHistory(dataset, history) { this.#saveState(`history/${dataset}`, history); }

  events(source) { return this.#state(`events/${source}`); }
  saveEvents(source, data) { this.#saveState(`events/${source}`, data); }
  archiveEvents(source, events) {
    this.transaction(() => {
      for (const e of events) this.#sql('INSERT INTO archived_events (source, year, body) VALUES (?, ?, ?)').run(source, (e.toDate ?? e.startedAt).slice(0, 4), JSON.stringify(e));
    });
  }
  /** Every archived event of a source, by year, then in the order they were archived. */
  archivedEvents(source) {
    return this.#sql('SELECT body FROM archived_events WHERE source = ? ORDER BY year, seq').all(source).map(r => JSON.parse(r.body));
  }

  counts(source) { return this.#state(`counts/${source}`); }
  /** Places and series in name order, as the FileStore writes them: both stores read the same back. */
  saveCounts(source, data) {
    const series = Object.fromEntries(Object.keys(data.series).sort().map(p => [p, sortKeys(data.series[p])]));
    this.#saveState(`counts/${source}`, { first: data.first, last: data.last, gaps: data.gaps, series });
  }

  conflictVersions(source) {
    const prefix = `conflict/${source}/`;
    return this.#sql('SELECT key FROM state WHERE substr(key, 1, ?) = ?').all(prefix.length, prefix).map(r => r.key.slice(prefix.length)).sort(byVersion);
  }
  conflict(source) {
    const versions = this.conflictVersions(source).map(v => this.#state(`conflict/${source}/${v}`));
    return versions.length ? { fetchedAt: versions.at(-1).fetchedAt, versions } : null;
  }
  /** The scalars, then the tables, then the events: the FileStore's order of keys. */
  saveConflictVersion(source, data) {
    const { events, ...head } = data;
    const entries = Object.entries(head);
    this.#saveState(`conflict/${source}/${data.version}`, Object.fromEntries([...entries.filter(([, v]) => !isTable(v)), ...entries.filter(([, v]) => isTable(v)), ['events', events]]));
  }

  context(source) { return this.#state(`context/${source}`); }
  saveContext(source, data) { this.#saveState(`context/${source}`, data); }

  signals() { return this.#state('signals'); }
  saveSignals(signals) { this.#saveState('signals', signals); }

  changes(year) {
    return this.#sql('SELECT body FROM changes WHERE substr(at, 1, 4) = ? ORDER BY seq').all(String(year)).map(r => JSON.parse(r.body));
  }
  appendChanges(changes) {
    this.transaction(() => {
      for (const c of changes) this.#sql('INSERT INTO changes (id, at, body) VALUES (?, ?, ?)').run(String(c.id ?? ''), c.at, JSON.stringify(c));
    });
  }
  /** The years the change log has, oldest first. */
  changeYears() {
    return this.#sql('SELECT DISTINCT substr(at, 1, 4) AS year FROM changes ORDER BY year').all().map(r => r.year);
  }

  sourcesState() { return this.#state('sources-state') ?? {}; }
  saveSourcesState(state) { this.#saveState('sources-state', state); }

  // ---- the fetch log (the `fetch_runs` table)
  appendFetchRun(entry) {
    this.#sql('INSERT INTO fetch_runs (time, source, result, duration_ms, body) VALUES (?, ?, ?, ?, ?)')
      .run(entry.time, entry.source, entry.result, entry.durationMs ?? null, JSON.stringify(entry));
  }
  /** The runs that started at or after `since` (a time in ms; all of them without it), in the order they were logged. */
  fetchRuns({ since } = {}) {
    const from = since == null ? '' : new Date(since).toISOString();
    return this.#sql('SELECT body FROM fetch_runs WHERE time >= ? ORDER BY seq').all(from).map(r => JSON.parse(r.body));
  }

  // ---- published site data (the `documents` table, served as stored)
  /** A row is rewritten only when its body differs, so an unchanged document keeps its ETag. */
  publish(relPath, data) {
    const body = JSON.stringify(data);
    if (this.#sql('SELECT 1 FROM documents WHERE path = ? AND body = ?').get(relPath, body)) return;
    const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 20)}"`;
    this.#sql('INSERT INTO documents (path, body, gzip, etag, updated_at) VALUES (?, ?, ?, ?, ?) '
      + 'ON CONFLICT (path) DO UPDATE SET body = excluded.body, gzip = excluded.gzip, etag = excluded.etag, updated_at = excluded.updated_at')
      .run(relPath, body, gzipSync(body), etag, this.#now().toISOString());
  }
  published(relPath) {
    const row = this.#sql('SELECT body FROM documents WHERE path = ?').get(relPath);
    return row ? JSON.parse(row.body) : null;
  }
  /** A whole build at once: every file, and the documents the build no longer makes are removed. */
  publishAll(files) {
    this.transaction(() => {
      for (const path of this.publishedPaths()) if (!Object.hasOwn(files, path)) this.#sql('DELETE FROM documents WHERE path = ?').run(path);
      for (const [path, data] of Object.entries(files)) this.publish(path, data);
    });
  }
  publishedPaths() { return this.#sql('SELECT path FROM documents ORDER BY path').all().map(r => r.path); }
  /** A document as it is served: { body, gzip, etag, updatedAt }, or null. */
  document(relPath) {
    const row = this.#sql('SELECT body, gzip, etag, updated_at FROM documents WHERE path = ?').get(relPath);
    return row ? { body: row.body, gzip: Buffer.from(row.gzip), etag: row.etag, updatedAt: row.updated_at } : null;
  }

  // ---- helpers
  #migrate() {
    const { user_version: version } = this.#db.prepare('PRAGMA user_version').get();
    if (version > MIGRATIONS.length) throw new Error(`The database is version ${version}; this code knows ${MIGRATIONS.length}`);
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.transaction(() => this.#db.exec(`${MIGRATIONS[v]}; PRAGMA user_version = ${v + 1}`));
    }
  }

  #sql(text) {
    let statement = this.#statements.get(text);
    if (!statement) this.#statements.set(text, statement = this.#db.prepare(text));
    return statement;
  }

  #state(key) {
    const row = this.#sql('SELECT body FROM state WHERE key = ?').get(key);
    return row ? JSON.parse(row.body) : null;
  }

  #saveState(key, data) {
    this.#sql('INSERT INTO state (key, body, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at')
      .run(key, JSON.stringify(data), this.#now().toISOString());
  }
}
