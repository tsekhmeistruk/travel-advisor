// The update job (scripts/update.mjs) on a copy of the repo's data in memory, with fetchers
// that answer from what is stored: what is fetched, that a build is published whole or not at
// all, and what is recorded. No request leaves the machine.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FileStore, ROOT } from '../../scripts/lib/store.mjs';
import { SqliteStore } from '../../scripts/lib/sqlite-store.mjs';
import { importFiles } from '../../scripts/tools/import-files.mjs';
import { runUpdate, SEED } from '../../scripts/update.mjs';
import { readBuildInput, dataYear } from '../../scripts/build.mjs';

const files = new FileStore(ROOT);
const MIN = 60000;
// After every fetch in the data, late in a day: each daily slot (never after 22:00) has passed.
const newest = Object.values(files.sourcesState()).map(s => s.lastAttempt).sort().at(-1);
const NOW = new Date(`${new Date(Date.parse(newest) + 2 * 864e5).toISOString().slice(0, 10)}T23:30:00.000Z`);
const ago = (minutes) => new Date(NOW - minutes * MIN).toISOString();
const ok = (minutes) => ({ lastAttempt: ago(minutes), lastSuccess: ago(minutes), consecutiveFailures: 0 });

/** Fetchers that return what is stored, and note that they were called. */
function fakes(calls, overrides = {}) {
  const events = (id) => ({ id, kind: 'events', source: `https://example.test/${id}`, fetch: async ({ previous }) => { calls.push(id); return { events: previous, stats: {} }; } });
  const advisories = (id) => ({ id, dataset: 'travel-advisories', source: `https://example.test/${id}`, fetch: async ({ previous }) => { calls.push(id); return { entries: previous, stats: {} }; } });
  return { gdacs: events('gdacs'), usgs: events('usgs'), who: events('who'), us: advisories('us'), ca: advisories('ca'), ...overrides };
}

/** The repo's data in memory, with the five fetchers' state set: gdacs and us due, the others not. */
function seeded(state = {}) {
  const store = new SqliteStore(':memory:');
  importFiles({ from: files, to: store });
  store.saveSourcesState({ ...store.sourcesState(), gdacs: ok(61), usgs: ok(10), who: ok(20), us: ok(26 * 60), ca: ok(60), ...state });
  return store;
}

const run = (store, opts = {}) => runUpdate({ store, now: () => NOW, print: () => {}, ...opts });

describe('the change log a build reads', () => {
  test('is of the year of the data\'s newest fetch and the year before, not of the wall clock', () => {
    const input = { datasets: [{ providers: [{ snapshot: { fetchedAt: '2024-12-31T23:00:00Z' } }, { snapshot: null }] }], sources: { gdacs: { data: { fetchedAt: '2025-06-01T00:00:00Z' } }, who: { data: null } }, sourcesState: {} };
    assert.equal(dataYear(input), 2025);
    assert.equal(dataYear({ ...input, sourcesState: { us: { lastAttempt: '2026-01-01T00:00:01Z' }, ca: {} } }), 2026);
    assert.equal(dataYear({ datasets: [], sources: {}, sourcesState: {} }), null);
    const year = Number(newest.slice(0, 4));
    assert.deepEqual(readBuildInput(files).risk.log, [...files.changes(year - 1), ...files.changes(year)]);
  });
  test('is empty for a store that never fetched', () => {
    const empty = new SqliteStore(':memory:');
    assert.deepEqual(readBuildInput(empty).risk.log, []);
    empty.close();
  });
});

describe('the update job', () => {
  let quiet, exitCode;
  before(() => { const { log, warn, error } = console; console.log = console.warn = console.error = () => {}; quiet = () => Object.assign(console, { log, warn, error }); exitCode = process.exitCode; });
  after(() => { quiet(); process.exitCode = exitCode; });

  test('with no ids: fetches what is due, the sources before the providers, builds and publishes', async () => {
    const store = seeded();
    const calls = [];
    const lines = [];
    const result = await run(store, { registry: fakes(calls), print: (l) => lines.push(l) });
    assert.deepEqual(calls, ['gdacs', 'us']);
    assert.deepEqual([result.fetched, result.failed], [['gdacs', 'us'], []]);
    assert.match(result.reasons.usgs, /^fetched 10 min ago$/);
    assert.equal(result.reasons.ca, 'already updated today');
    assert.ok(lines.includes('run  gdacs: last success 61 min ago') && lines.some(l => l.startsWith('skip usgs:')), lines.join('\n'));
    assert.deepEqual(result.build, { at: NOW.toISOString(), ok: true, files: store.publishedPaths().length, changes: result.build.changes });
    assert.deepEqual(store.meta('lastBuild'), result.build);
    assert.equal(store.published('manifest.json').risk.asOf, NOW.toISOString(), 'the published data is the new build');
    assert.equal(store.sourcesState().gdacs.lastSuccess, NOW.toISOString());
    assert.deepEqual(store.fetchRuns().slice(files.fetchRuns().length).map(r => [r.source, r.result]), [['gdacs', 'ok'], ['us', 'ok']], 'each fetch is logged in the store');
    store.close();
  });

  test('nothing due: no fetch and no build', async () => {
    const store = seeded({ gdacs: ok(5), us: ok(30) });
    const calls = [];
    const before = store.document('manifest.json');
    const result = await run(store, { registry: fakes(calls) });
    assert.deepEqual([calls, result.fetched, result.build], [[], [], null]);
    assert.deepEqual(store.document('manifest.json'), before);
    assert.equal(store.meta('lastBuild'), null);
    store.close();
  });

  test('with ids: fetches those, due or not; "all" is every one; an unknown id is refused', async () => {
    const store = seeded();
    const calls = [];
    const result = await run(store, { registry: fakes(calls), ids: ['ca', 'usgs'] });
    assert.deepEqual([calls, result.fetched], [['usgs', 'ca'], ['usgs', 'ca']]);
    assert.equal(result.build.ok, true);
    calls.length = 0;
    await run(store, { registry: fakes(calls), ids: ['all'] });
    assert.deepEqual(calls, ['gdacs', 'usgs', 'who', 'us', 'ca']);
    await assert.rejects(run(store, { registry: fakes(calls), ids: ['gdacs', 'nope'] }), /Unknown: nope\. Known: gdacs, usgs, who, us, ca/);
    store.close();
  });

  test('--build: fetches nothing, builds and publishes', async () => {
    const store = seeded();
    const calls = [];
    const result = await run(store, { registry: fakes(calls), buildOnly: true, ids: ['gdacs'] });
    assert.deepEqual([calls, result.fetched, result.build.ok], [[], [], true]);
    assert.equal(store.meta('lastBuild').files, store.publishedPaths().length);
    store.close();
  });

  test('a failed fetch keeps its data and is named, and the build still goes on', async () => {
    const store = seeded();
    const calls = [];
    const events = store.events('gdacs');
    const registry = fakes(calls, { gdacs: { id: 'gdacs', kind: 'events', source: 'https://example.test/gdacs', fetch: async () => { throw new Error('site down'); } } });
    const result = await run(store, { registry });
    assert.deepEqual([result.fetched, result.failed, calls], [['gdacs', 'us'], ['gdacs'], ['us']]);
    assert.deepEqual(store.events('gdacs'), events);
    assert.equal(result.build.ok, true);
    assert.equal(store.published('risk/health.json').sources.gdacs.consecutiveFailures, 1, 'the failure shows in the published health');
    store.close();
  });

  test('a build with a name it can\'t place publishes nothing and records why', async () => {
    const store = seeded();
    const before = store.document('manifest.json');
    const history = store.history('travel-advisories');
    const us = { id: 'us', dataset: 'travel-advisories', source: 'https://example.test/us', fetch: async ({ previous }) => ({ entries: [...previous, { ...previous[0], name: 'Atlantis' }], stats: {} }) };
    const result = await run(store, { registry: fakes([], { us }) });
    assert.equal(result.build.ok, false);
    assert.match(result.build.errors.join('\n'), /Atlantis/);
    assert.deepEqual(store.meta('lastBuild'), result.build);
    assert.deepEqual(store.document('manifest.json'), before, 'the last good data stays');
    assert.deepEqual(store.history('travel-advisories'), history);
    store.close();
  });

  test('a build that fails the checks (a provider lost its records) publishes nothing and records why', async () => {
    const store = seeded();
    // As if the last publish had a third more U.S. records than this fetch brings.
    const last = store.published('travel-advisories/us.json');
    store.publish('travel-advisories/us.json', { ...last, records: [...last.records, ...last.records.slice(0, Math.ceil(last.records.length / 3))] });
    const before = store.document('travel-advisories/us.json');
    const signals = store.signals();
    const lines = [];
    const result = await run(store, { registry: fakes([]), print: (l) => lines.push(l) });
    assert.equal(result.build.ok, false);
    assert.match(result.build.errors.join('\n'), /^travel-advisories\/us\.json: \d+ records, \d+ were published \(under 80%\)$/);
    assert.match(lines.join('\n'), /Not published:\ntravel-advisories\/us\.json/);
    assert.deepEqual(store.document('travel-advisories/us.json'), before);
    assert.deepEqual([store.signals(), store.changeYears()], [signals, files.changeYears()]);
    assert.deepEqual(store.meta('lastBuild'), result.build);
    store.close();
  });

  test('a build is one transaction: a failure while writing leaves nothing of it', async () => {
    const store = seeded();
    const before = { manifest: store.document('manifest.json'), history: store.history('travel-advisories'), paths: store.publishedPaths() };
    store.saveSignals = () => { throw new Error('disk full'); };
    await assert.rejects(run(store, { registry: fakes([]) }), /disk full/);
    assert.deepEqual({ manifest: store.document('manifest.json'), history: store.history('travel-advisories'), paths: store.publishedPaths() }, before);
    assert.equal(store.meta('lastBuild'), null);
    store.close();
  });

  test('the backend\'s seed is its own, so its daily slot differs from the workflow\'s', () => {
    assert.equal(SEED, 'risk-monitor');
  });
});
