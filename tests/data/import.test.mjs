// Import and export on the repo's own data: the database must hold exactly what the files
// hold. A build from the imported database equals a build from the files, and an export of
// it gives the same files back, byte for byte. Written to memory and temporary folders.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { FileStore, ROOT } from '../../scripts/lib/store.mjs';
import { SqliteStore } from '../../scripts/lib/sqlite-store.mjs';
import { readBuildInput, buildAll } from '../../scripts/build.mjs';
import { importFiles, exportFiles, copyStore } from '../../scripts/tools/import-files.mjs';
import { pullData, clearData } from '../../scripts/tools/pull-data.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'trm-import-'));
const files = new FileStore(ROOT);

/** Every file under root/dir as { 'dir/…': bytes }, without the map's shapes. */
function tree(root, dirs = ['data', 'logs/fetch', 'site/data']) {
  const out = {};
  for (const dir of dirs) {
    const full = join(root, ...dir.split('/'));
    for (const entry of existsSync(full) ? readdirSync(full, { recursive: true, withFileTypes: true }) : []) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      const rel = path.slice(root.length + 1).replaceAll('\\', '/');
      if (!rel.startsWith('site/data/geo/') && entry.name !== '.gitkeep') out[rel] = readFileSync(path);
    }
  }
  return out;
}

function assertSameTree(actual, expected) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'the same files');
  for (const [path, bytes] of Object.entries(expected)) assert.ok(bytes.equals(actual[path]), `${path} differs`);
}

describe('import and export (the repo\'s data)', () => {
  let db, done, repo;
  before(() => {
    db = new SqliteStore(':memory:');
    done = importFiles({ from: files, to: db });
    repo = tree(ROOT);
  });
  after(() => db.close());

  test('the import takes everything the files hold', () => {
    assert.equal(done.published, files.publishedPaths().length);
    assert.equal(done.fetchRuns, files.fetchRuns().length);
    assert.equal(done.changes, files.changeYears().flatMap(y => files.changes(y)).length);
    assert.equal(done.sources, files.sourceIds().length, 'every source has data');
    assert.ok(done.snapshots >= 5 && done.histories >= 1 && done.archivedEvents > 0 && done.fetchRuns > 100 && done.published > 250, JSON.stringify(done));
    assert.deepEqual(db.sourcesState(), files.sourcesState());
    assert.deepEqual(db.signals(), files.signals());
    assert.deepEqual(db.published('manifest.json'), files.published('manifest.json'));
  });

  test('a build from the imported database equals a build from the files', () => {
    const fromFiles = buildAll(readBuildInput(files));
    const fromDb = buildAll(readBuildInput(db));
    assert.deepEqual(fromDb.problems, []);
    assert.equal(JSON.stringify(fromDb), JSON.stringify(fromFiles), 'the same output, in the same order of keys');
  });

  test('import, then export, gives the same files, byte for byte', () => {
    const out = tmp();
    exportFiles({ from: db, to: new FileStore(out) });
    assertSameTree(tree(out), repo);
    rmSync(out, { recursive: true });
  });

  test('a second copy into the same store is refused: changes and runs would double', () => {
    assert.throws(() => importFiles({ from: files, to: db }), /copy into an empty store/);
    const out = tmp();
    const target = new FileStore(out);
    target.archiveEvents('gdacs', [{ id: 'e', startedAt: '2026-01-01' }]);
    assert.throws(() => exportFiles({ from: db, to: target }), /copy into an empty store/);
    assert.deepEqual(target.publishedPaths(), [], 'nothing was written');
    rmSync(out, { recursive: true });
  });

  test('a folder with data alone (the data branch) is imported with the repo\'s configuration', () => {
    const out = tmp();
    exportFiles({ from: db, to: new FileStore(out) });
    const restored = new SqliteStore(':memory:');
    const again = importFiles({ from: new FileStore(out), to: restored, config: files });
    assert.deepEqual(again, done);
    assert.equal(JSON.stringify(restored.conflict('ucdp')), JSON.stringify(db.conflict('ucdp')));
    restored.close();
    rmSync(out, { recursive: true });
  });

  test('an empty store copies as nothing, and writes no empty documents', () => {
    const empty = new SqliteStore(':memory:');
    const out = tmp();
    assert.deepEqual(copyStore({ from: empty, to: new FileStore(out) }), { snapshots: 0, histories: 0, sources: 0, changes: 0, archivedEvents: 0, fetchRuns: 0, published: 0 });
    assert.deepEqual(tree(out), {});
    empty.close();
    rmSync(out, { recursive: true });
  });
});

describe('pull-data (the backend\'s export into files)', () => {
  /** The repo's data as the backend would send it: a database file, gzipped. */
  const exported = (fill = (store) => importFiles({ from: files, to: store })) => {
    const dir = tmp();
    const store = new SqliteStore(join(dir, 'risk.db'));
    fill(store);
    store.close();
    const body = gzipSync(readFileSync(join(dir, 'risk.db')));
    rmSync(dir, { recursive: true });
    return body;
  };

  test('downloads with the token, replaces the folder\'s data and keeps the map\'s shapes', async () => {
    const out = tmp();
    for (const [path, text] of Object.entries({ 'data/changes/2026.jsonl': '{"id":"stale","at":"2026-01-01"}\n', 'data/conflict/ucdp/1.0.1.json': '{}', 'logs/fetch/2020/2020-01.jsonl': '{}\n',
      'site/data/old.json': '{}', 'site/data/geo/countries-50m.json': '{"kept":true}', 'logs/README.md': 'kept' })) {
      mkdirSync(join(out, path, '..'), { recursive: true });
      writeFileSync(join(out, path), text);
    }
    const asked = [];
    const body = exported();
    const done = await pullData({ base: 'https://backend.test', token: 'secret', out, fetch: async (url, init) => { asked.push([String(url), init.headers.authorization]); return new Response(body); } });
    assert.deepEqual(asked, [['https://backend.test/admin/export', 'Bearer secret']]);
    assert.equal(done.published, files.publishedPaths().length);
    assertSameTree(tree(out), tree(ROOT));
    assert.equal(readFileSync(join(out, 'site', 'data', 'geo', 'countries-50m.json'), 'utf8'), '{"kept":true}');
    assert.equal(readFileSync(join(out, 'logs', 'README.md'), 'utf8'), 'kept');
    rmSync(out, { recursive: true });
  });

  test('a refused download or an export without published data writes nothing', async () => {
    const out = tmp();
    mkdirSync(join(out, 'data'));
    writeFileSync(join(out, 'data', 'sources-state.json'), '{"kept":{}}');
    await assert.rejects(pullData({ base: 'https://backend.test/', token: 'wrong', out, fetch: async () => new Response('no', { status: 404 }) }), /admin\/export answered HTTP 404/);
    const empty = exported(() => {});
    await assert.rejects(pullData({ base: 'https://backend.test', token: 't', out, fetch: async () => new Response(empty) }), /no published data/);
    assert.deepEqual(Object.keys(tree(out)), ['data/sources-state.json']);
    rmSync(out, { recursive: true });
  });

  test('clearing a folder without data does nothing', () => {
    const out = tmp();
    clearData(out);
    assert.deepEqual(readdirSync(out), []);
    rmSync(out, { recursive: true });
  });
});
