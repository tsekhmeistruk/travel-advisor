// The pipeline's stores: one contract, run on the files (FileStore) and on SQLite (SqliteStore),
// then what only one of them does. Everything is written to temporary folders or to memory.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { FileStore, createStore } from '../../../scripts/lib/store.mjs';
import { SqliteStore } from '../../../scripts/lib/sqlite-store.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'trm-store-'));

const STORES = {
  FileStore: (root) => new FileStore(root),
  SqliteStore: (root) => new SqliteStore(':memory:', { root }),
};

/** Run `fn` on a fresh store over an empty folder, then close and remove both. */
const withStore = (make, fn) => {
  const root = tmp();
  const store = make(root);
  try { fn(store, root); } finally { store.close(); rmSync(root, { recursive: true }); }
};

const version = (v, month) => ({
  version: v, month, events: [[1, `${month}-01`, 369, '', '1:13243', 5, 57, 61, 0, 50.45, 30.52, 1], [2, `${month}-02`, 369, 'Kyiv oblast', '1:13243', 1, 57, 61, 1, null, null, 6]],
  countries: { 369: 'Ukraine' }, fetchedAt: `${month}-28T00:00:00.000Z`, actors: { 57: 'Government of Russia (Soviet Union)', 61: 'Government of Ukraine' },
  format: 2, conflicts: { '1:13243': { name: 'Russia - Ukraine' } },
});

for (const [name, make] of Object.entries(STORES)) {
  describe(`store contract: ${name}`, () => {
    test('missing data is null, except the history and the sources state ({}) and the lists ([])', () => withStore(make, (store) => {
      for (const read of [() => store.snapshot('ds', 'p'), () => store.events('gdacs'), () => store.counts('gdelt'), () => store.conflict('ucdp'),
        () => store.context('wikipedia'), () => store.signals(), () => store.published('x/y.json')]) assert.equal(read(), null);
      for (const read of [() => store.history('ds'), () => store.sourcesState()]) assert.deepEqual(read(), {});
      for (const read of [() => store.changes(2026), () => store.changeYears(), () => store.conflictVersions('ucdp'), () => store.archivedEvents('gdacs'),
        () => store.publishedPaths()]) assert.deepEqual(read(), []);
    }));

    test('reads the configuration from the repo\'s files', () => withStore(make, (store, root) => {
      assert.throws(() => store.places(), /Missing .*places\.json/);
      assert.deepEqual([store.datasetIds(), store.sourceIds(), store.locales()], [[], [], []], 'no folders yet');
      const write = (path, data) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), JSON.stringify(data)); };
      write('config/places.json', [{ id: 'fr' }]);
      write('config/categories.json', { categories: [] });
      write('config/schedule.json', { gdacs: { everyMinutes: 60 } });
      write('config/datasets/b.json', { id: 'b' });
      write('config/datasets/a.json', { id: 'a' });
      write('config/providers/us.json', { id: 'us' });
      write('config/sources/gdacs.json', { id: 'gdacs' });
      write('site/i18n/en.json', { title: 'T' });
      write('site/data/geo/countries-50m.json', { objects: {} });
      assert.deepEqual(store.places(), [{ id: 'fr' }]);
      assert.deepEqual(store.categories(), { categories: [] });
      assert.deepEqual(store.schedule(), { gdacs: { everyMinutes: 60 } });
      assert.deepEqual([store.datasetIds(), store.dataset('a')], [['a', 'b'], { id: 'a' }]);
      assert.deepEqual(store.provider('us'), { id: 'us' });
      assert.deepEqual([store.sourceIds(), store.source('gdacs')], [['gdacs'], { id: 'gdacs' }]);
      assert.deepEqual([store.locales(), store.locale('en')], [['en'], { title: 'T' }]);
      assert.deepEqual(store.geo(), { objects: {} });
      assert.deepEqual(store.publishedPaths(), [], 'the map\'s shapes are not published data');
    }));

    test('saves and reads snapshots, histories, events, a context, the signals and the sources state', () => withStore(make, (store) => {
      store.saveSnapshot('ds', 'p', { entries: [1] });
      store.saveSnapshot('ds', 'q', { entries: [2] });
      store.saveSnapshot('ds', 'p', { entries: [1, 3] });
      store.saveHistory('ds', { p: { Mexico: [{ date: '2026-09-26', level: 2 }] } });
      store.saveEvents('gdacs', { fetchedAt: 'x', events: [{ id: 'e' }] });
      store.saveContext('wikipedia', { fetchedAt: 'y', articles: { 'Gaza war': { title: 'Gaza war', sides: [] } } });
      store.saveSignals({ categories: {} });
      store.saveSourcesState({ us: { lastSuccess: 'x' } });
      assert.deepEqual([store.snapshot('ds', 'p'), store.snapshot('ds', 'q')], [{ entries: [1, 3] }, { entries: [2] }], 'a second save replaces the first');
      assert.deepEqual(store.history('ds'), { p: { Mexico: [{ date: '2026-09-26', level: 2 }] } });
      assert.deepEqual(store.events('gdacs'), { fetchedAt: 'x', events: [{ id: 'e' }] });
      assert.deepEqual(store.context('wikipedia'), { fetchedAt: 'y', articles: { 'Gaza war': { title: 'Gaza war', sides: [] } } });
      assert.deepEqual(store.signals(), { categories: {} });
      assert.deepEqual(store.sourcesState(), { us: { lastSuccess: 'x' } });
    }));

    test('reads daily counts back with places and series in name order', () => withStore(make, (store) => {
      const data = { first: '2026-09-01', last: '2026-09-02', gaps: ['2026-09-02'], series: { fr: { violence: [0, 1], protest: [3, 0] }, et: { protest: [2, 0], violence: [0, 0] } } };
      store.saveCounts('gdelt', data);
      store.saveCounts('gdelt-pairs', { first: null, last: null, gaps: [], series: {} });
      assert.deepEqual(store.counts('gdelt'), data);
      assert.equal(JSON.stringify(store.counts('gdelt').series), '{"et":{"protest":[2,0],"violence":[0,0]},"fr":{"protest":[3,0],"violence":[0,1]}}');
      assert.deepEqual(store.counts('gdelt-pairs'), { first: null, last: null, gaps: [], series: {} });
    }));

    test('keeps conflict versions in version order, each with its scalars, tables, then events', () => withStore(make, (store) => {
      for (const v of [version('24.0.10', '2024-10'), version('24.0.9', '2024-09'), version('25.0.1', '2025-01')]) store.saveConflictVersion('ucdp', v);
      store.saveConflictVersion('other', version('23.0.1', '2023-01'));
      assert.deepEqual(store.conflictVersions('ucdp'), ['24.0.9', '24.0.10', '25.0.1'], 'by number, not as text');
      const all = store.conflict('ucdp');
      assert.equal(all.fetchedAt, '2025-01-28T00:00:00.000Z', 'the latest version\'s');
      assert.deepEqual(all.versions.map(v => v.version), ['24.0.9', '24.0.10', '25.0.1']);
      assert.deepEqual(all.versions[1], version('24.0.10', '2024-10'));
      assert.deepEqual(Object.keys(all.versions[1]), ['version', 'month', 'fetchedAt', 'format', 'countries', 'actors', 'conflicts', 'events']);
    }));

    test('appends changes and reads them by year, oldest first', () => withStore(make, (store) => {
      store.appendChanges([{ id: 'a', at: '2025-12-31T23:00:00Z' }, { id: 'b', at: '2026-01-01T00:00:00Z' }]);
      store.appendChanges([{ id: 'c', at: '2026-02-01' }, { id: 'd', at: '2026-01-15', from: 1, to: 3 }]);
      store.appendChanges([]);
      assert.deepEqual(store.changes(2025), [{ id: 'a', at: '2025-12-31T23:00:00Z' }]);
      assert.deepEqual(store.changes('2026').map(c => c.id), ['b', 'c', 'd'], 'in the order they were appended, not by time');
      assert.deepEqual(store.changes(2026)[2], { id: 'd', at: '2026-01-15', from: 1, to: 3 });
      assert.deepEqual(store.changeYears(), ['2025', '2026']);
      assert.deepEqual(store.changes(2024), []);
    }));

    test('archives events by the year they ended, and lists them by year, then as archived', () => withStore(make, (store) => {
      store.archiveEvents('gdacs', [{ id: 'e1', toDate: '2026-03-01T00:00:00Z' }, { id: 'e2', startedAt: '2025-06-01T00:00:00Z' }]);
      store.archiveEvents('gdacs', [{ id: 'e3', toDate: '2026-01-01T00:00:00Z', startedAt: '2025-12-01T00:00:00Z' }]);
      store.archiveEvents('who', [{ id: 'w1', startedAt: '2026-05-01T00:00:00Z' }]);
      assert.deepEqual(store.archivedEvents('gdacs').map(e => e.id), ['e2', 'e1', 'e3']);
      assert.deepEqual(store.archivedEvents('who'), [{ id: 'w1', startedAt: '2026-05-01T00:00:00Z' }]);
      assert.deepEqual(store.archivedEvents('usgs'), []);
    }));

    test('publishes files one by one or a whole build, and lists their paths', () => withStore(make, (store) => {
      store.publish('x/y.json', { ok: true });
      store.publishAll({ 'manifest.json': { asOf: 'now' }, 'risk/places/fr.json': { id: 'fr' } });
      store.publish('x/y.json', { ok: false });
      assert.deepEqual(store.published('x/y.json'), { ok: false });
      assert.deepEqual(store.published('risk/places/fr.json'), { id: 'fr' });
      assert.ok(store.publishedPaths().includes('manifest.json') && store.publishedPaths().includes('risk/places/fr.json'));
      assert.deepEqual(store.publishedPaths(), [...store.publishedPaths()].sort());
    }));

    test('appends fetch runs and reads them in the order they were logged, all or since a time', () => withStore(make, (store) => {
      assert.deepEqual(store.fetchRuns(), []);
      const run = (time, source, more = {}) => ({ time, source, run: 'local', trigger: 'local', result: 'ok', durationMs: 1200, calls: {}, stats: {}, ...more });
      store.appendFetchRun(run('2025-12-31T23:59:00.000Z', 'us'));
      store.appendFetchRun(run('2026-09-30T10:00:00.000Z', 'ca', { result: 'error', error: 'boom' }));
      store.appendFetchRun(run('2026-09-30T09:00:00.000Z', 'gdacs'));
      store.appendFetchRun(run('2026-10-01T00:00:00.000Z', 'who', { stats: { events: 3 } }));
      assert.deepEqual(store.fetchRuns().map(e => e.source), ['us', 'ca', 'gdacs', 'who']);
      assert.deepEqual(store.fetchRuns()[1], run('2026-09-30T10:00:00.000Z', 'ca', { result: 'error', error: 'boom' }));
      assert.deepEqual(store.fetchRuns({ since: Date.parse('2026-09-30T09:30:00Z') }).map(e => e.source), ['ca', 'who']);
      assert.deepEqual(store.fetchRuns({ since: Date.parse('2026-10-01T00:00:00Z') }).map(e => e.source), ['who'], 'at the time itself: in');
      assert.deepEqual(store.fetchRuns({ since: Date.parse('2027-01-01T00:00:00Z') }), []);
    }));

    test('keeps notes about itself by key', () => withStore(make, (store) => {
      assert.equal(store.meta('lastBuild'), null);
      const note = { at: '2026-10-03T10:00:00.000Z', ok: false, errors: ['x'] };
      store.saveMeta('lastBuild', note);
      note.errors.push('changed after the save');
      store.saveMeta('seeded', true);
      store.saveMeta('lastBuild', { ...store.meta('lastBuild'), ok: true });
      assert.deepEqual([store.meta('lastBuild'), store.meta('seeded')], [{ at: '2026-10-03T10:00:00.000Z', ok: true, errors: ['x'] }, true]);
    }));

    test('a transaction returns what its function returns, and may hold another', () => withStore(make, (store) => {
      const result = store.transaction(() => {
        store.saveSignals({ n: 1 });
        return store.transaction(() => { store.appendChanges([{ id: 'a', at: '2026-01-01' }]); return 'done'; });
      });
      assert.equal(result, 'done');
      assert.deepEqual([store.signals(), store.changes(2026).length], [{ n: 1 }, 1]);
    }));
  });
}

describe('FileStore: the files it writes', () => {
  test('daily counts: one line per place', () => withStore(STORES.FileStore, (store, root) => {
    store.saveCounts('gdelt', { first: '2026-09-01', last: '2026-09-02', gaps: [], series: { fr: { violence: [0, 1], protest: [3, 0] }, et: { protest: [2, 0], violence: [0, 0] } } });
    const lines = readFileSync(join(root, 'data', 'counts', 'gdelt.json'), 'utf8').split('\n');
    assert.deepEqual(lines.slice(1, 3), [' "et": {"protest": [2,0], "violence": [0,0]},', ' "fr": {"protest": [3,0], "violence": [0,1]}']);
  }));

  test('a conflict version: the scalars first, each table one entry per line, one event per line', () => withStore(STORES.FileStore, (store, root) => {
    store.saveConflictVersion('ucdp', version('25.0.1', '2025-01'));
    const lines = readFileSync(join(root, 'data', 'conflict', 'ucdp', '25.0.1.json'), 'utf8').split('\n');
    assert.deepEqual(lines.slice(-4), ['[1,"2025-01-01",369,"","1:13243",5,57,61,0,50.45,30.52,1],', '[2,"2025-01-02",369,"Kyiv oblast","1:13243",1,57,61,1,null,null,6]', ']}', '']);
    assert.equal(lines[0], '{"version": "25.0.1", "month": "2025-01", "fetchedAt": "2025-01-28T00:00:00.000Z", "format": 2,');
    assert.ok(lines.includes('"actors": {') && lines.includes('"61": "Government of Ukraine"'));
  }));

  test('documents end with a newline; changes and archived events are a file per year', () => withStore(STORES.FileStore, (store, root) => {
    store.saveContext('wikipedia', { fetchedAt: 'y', articles: {} });
    store.appendChanges([{ id: 'a', at: '2025-12-31T23:00:00Z' }, { id: 'b', at: '2026-01-01T00:00:00Z' }]);
    store.archiveEvents('gdacs', [{ id: 'e1', toDate: '2026-03-01T00:00:00Z' }, { id: 'e2', startedAt: '2025-06-01T00:00:00Z' }]);
    assert.ok(readFileSync(join(root, 'data', 'context', 'wikipedia.json'), 'utf8').endsWith('\n'));
    assert.equal(readFileSync(join(root, 'data', 'changes', '2025.jsonl'), 'utf8'), '{"id":"a","at":"2025-12-31T23:00:00Z"}\n');
    assert.match(readFileSync(join(root, 'data', 'archive', 'events', 'gdacs', '2026.jsonl'), 'utf8'), /"e1"/);
    assert.match(readFileSync(join(root, 'data', 'archive', 'events', 'gdacs', '2025.jsonl'), 'utf8'), /"e2"/);
  }));

  test('fetch runs: a file per month, and a damaged line is skipped', () => withStore(STORES.FileStore, (store, root) => {
    store.appendFetchRun({ time: '2026-08-31T10:00:00.000Z', source: 'us' });
    store.appendFetchRun({ time: '2026-09-27T10:00:00.000Z', source: 'ca' });
    assert.equal(readFileSync(join(root, 'logs', 'fetch', '2026', '2026-08.jsonl'), 'utf8'), '{"time":"2026-08-31T10:00:00.000Z","source":"us"}\n');
    writeFileSync(join(root, 'logs', 'fetch', '2026', '2026-08.jsonl'), 'not json\n\n', { flag: 'a' });
    assert.deepEqual(store.fetchRuns().map(e => e.source), ['us', 'ca']);
    assert.deepEqual(store.fetchRuns({ since: Date.parse('2026-09-01T00:00:00Z') }).map(e => e.source), ['ca']);
  }));

  test('a damaged line of the change log fails the read', () => withStore(STORES.FileStore, (store, root) => {
    store.appendChanges([{ id: 'a', at: '2026-01-01' }]);
    writeFileSync(join(root, 'data', 'changes', '2026.jsonl'), 'not json\n', { flag: 'a' });
    assert.throws(() => store.changes(2026), SyntaxError);
  }));

  test('a whole build leaves the other published files where they are', () => withStore(STORES.FileStore, (store) => {
    store.publish('old.json', { old: true });
    store.publishAll({ 'manifest.json': {} });
    assert.deepEqual(store.publishedPaths(), ['manifest.json', 'old.json']);
  }));
});

describe('SqliteStore: the database', () => {
  test('a transaction that throws writes nothing', () => withStore(STORES.SqliteStore, (store) => {
    store.saveSignals({ n: 1 });
    store.publish('manifest.json', { asOf: 'before' });
    assert.throws(() => store.transaction(() => {
      store.publishAll({ 'manifest.json': { asOf: 'after' }, 'new.json': {} });
      store.saveHistory('ds', { p: {} });
      store.saveSignals({ n: 2 });
      store.appendChanges([{ id: 'a', at: '2026-01-01' }]);
      store.archiveEvents('gdacs', [{ id: 'e', startedAt: '2026-01-01' }]);
      throw new Error('boom');
    }), /boom/);
    assert.deepEqual(store.signals(), { n: 1 });
    assert.deepEqual(store.published('manifest.json'), { asOf: 'before' });
    assert.deepEqual([store.publishedPaths(), store.history('ds'), store.changes(2026), store.archivedEvents('gdacs')], [['manifest.json'], {}, [], []]);
    store.transaction(() => store.saveSignals({ n: 3 }));
    assert.deepEqual(store.signals(), { n: 3 }, 'the next transaction works');
  }));

  test('a whole build removes the documents it no longer makes', () => withStore(STORES.SqliteStore, (store) => {
    store.publishAll({ 'manifest.json': {}, 'risk/places/fr.json': { id: 'fr' }, 'risk/places/xx.json': { id: 'xx' } });
    store.publishAll({ 'manifest.json': {}, 'risk/places/fr.json': { id: 'fr' } });
    assert.deepEqual(store.publishedPaths(), ['manifest.json', 'risk/places/fr.json']);
    assert.equal(store.published('risk/places/xx.json'), null);
  }));

  test('a document is stored minified and gzipped; unchanged, it keeps its ETag and time', () => {
    const times = ['2026-10-03T10:00:00Z', '2026-10-03T11:00:00Z', '2026-10-03T12:00:00Z'].map(t => new Date(t));
    const root = tmp();
    const store = new SqliteStore(':memory:', { root, now: () => times.shift() });
    assert.equal(store.document('manifest.json'), null);
    store.publish('manifest.json', { asOf: 'a', list: [1, 2] });
    const first = store.document('manifest.json');
    assert.equal(first.body, '{"asOf":"a","list":[1,2]}');
    assert.equal(gunzipSync(first.gzip).toString(), first.body);
    assert.match(first.etag, /^"[0-9a-f]{20}"$/);
    assert.equal(first.updatedAt, '2026-10-03T10:00:00.000Z');
    store.publishAll({ 'manifest.json': { asOf: 'a', list: [1, 2] } });
    assert.deepEqual(store.document('manifest.json'), first, 'the same body: the row is not rewritten');
    store.publish('manifest.json', { asOf: 'b', list: [1, 2] });
    const second = store.document('manifest.json');
    assert.notEqual(second.etag, first.etag);
    assert.equal(second.updatedAt, '2026-10-03T11:00:00.000Z');
    store.close();
    rmSync(root, { recursive: true });
  });

  test('a second open of the same file reads what the first wrote, and the schema is made once', () => {
    const root = tmp();
    const file = join(root, 'risk.db');
    const first = new SqliteStore(file, { root });
    first.saveSnapshot('ds', 'p', { entries: [1] });
    first.appendChanges([{ id: 'a', at: '2026-01-01' }]);
    first.publish('manifest.json', { asOf: 'a' });
    const second = new SqliteStore(file, { root });
    assert.deepEqual(second.snapshot('ds', 'p'), { entries: [1] });
    assert.deepEqual(second.changes(2026), [{ id: 'a', at: '2026-01-01' }]);
    second.saveSignals({ n: 1 });
    assert.deepEqual(first.signals(), { n: 1 }, 'and the first reads what the second wrote');
    first.close();
    second.close();
    const again = new SqliteStore(file, { root });
    assert.deepEqual(again.published('manifest.json'), { asOf: 'a' }, 'kept after every connection closed');
    again.close();
    rmSync(root, { recursive: true });
  });

  test('refuses a database made by newer code', () => {
    const root = tmp();
    const file = join(root, 'risk.db');
    new SqliteStore(file, { root }).close();
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(file);
    db.exec('PRAGMA user_version = 99');
    db.close();
    assert.throws(() => new SqliteStore(file, { root }), /version 99/);
    rmSync(root, { recursive: true });
  });
});

describe('createStore', () => {
  test('the repo\'s files by default, SQLite when DB_PATH is set', () => {
    const root = tmp();
    const files = createStore({ env: {}, root });
    assert.ok(files instanceof FileStore);
    assert.equal(files.root, root);
    const db = createStore({ env: { DB_PATH: join(root, 'risk.db') }, root });
    assert.ok(db instanceof SqliteStore);
    db.saveSignals({ n: 1 });
    db.close();
    const again = createStore({ env: { DB_PATH: join(root, 'risk.db') }, root });
    assert.deepEqual(again.signals(), { n: 1 });
    again.close();
    assert.ok(createStore() instanceof FileStore, 'no DB_PATH in the tests\' environment');
    rmSync(root, { recursive: true });
  });
});
