// Pipeline infrastructure: run logging to disk, storage, the fetch runner, the log summary
// and the local server. Everything writes to temporary folders, never the real repo.

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRunLog, withRunLog, logFile } from '../../../scripts/lib/fetch-log.mjs';
import { FileStore } from '../../../scripts/lib/store.mjs';
import { runFetch } from '../../../scripts/fetch.mjs';
import { runDue } from '../../../scripts/due.mjs';
import { readEntries, renderRunSummary, renderRecent, result, callSummary, describe as describeRun, duration, cell, flagEmoji, providerLabels, renderHealth } from '../../../scripts/lib/log-summary.mjs';
import { serve } from '../../../scripts/serve.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'trm-test-'));
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

let quiet;
before(() => { const { log, warn, error } = console; console.log = console.warn = console.error = () => {}; quiet = () => Object.assign(console, { log, warn, error }); });
after(() => quiet());

describe('run log', () => {
  test('counts aggregated requests instead of listing them', async () => {
    const statuses = [200, 200, 404];
    globalThis.fetch = async () => new Response('ok', { status: statuses.shift() });
    const root = tmp();
    const log = startRunLog('ca', { root });
    for (let i = 0; i < 3; i++) await log.request('pages', `https://example.test/${i}`, {}, { detail: false });
    log.write();
    const [entry] = readFileSync(logFile(new Date(), root), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(entry.calls.pages.requests, 3);
    assert.deepEqual(entry.calls.pages.statuses, { 200: 2, 404: 1 });
    rmSync(root, { recursive: true });
  });

  test('returns a binary body as a Buffer, unchanged', async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x80]);
    globalThis.fetch = async () => new Response(bytes, { status: 200 });
    const root = tmp();
    const log = startRunLog('gdelt', { root });
    const res = await log.request('daily', 'https://example.test/x.zip', {}, { detail: false, binary: true });
    assert.ok(Buffer.isBuffer(res.body));
    assert.deepEqual(res.body, bytes);
    assert.equal(res.ok, true);
    rmSync(root, { recursive: true });
  });

  test('records Retry-After on throttled responses', async () => {
    globalThis.fetch = async () => new Response('', { status: 429, headers: { 'retry-after': '120' } });
    const root = tmp();
    const log = startRunLog('us', { root });
    await log.request('api', 'https://example.test/api');
    log.write();
    const entry = JSON.parse(readFileSync(logFile(new Date(), root), 'utf8'));
    assert.deepEqual(entry.calls.api.attempts[0], { status: 429, ms: entry.calls.api.attempts[0].ms, retryAfter: '120' });
    rmSync(root, { recursive: true });
  });

  test('withRunLog always writes a line, and a failure sets a non-zero exit code', async () => {
    const root = tmp();
    const saved = process.exitCode;
    await withRunLog('us', async (log) => { log.stat({ n: 1 }); log.warn('careful'); }, { root });
    await withRunLog('us', async () => { throw new Error('boom'); }, { root });
    const lines = readFileSync(logFile(new Date(), root), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 2);
    assert.deepEqual([lines[0].result, lines[0].stats, lines[0].warnings], ['ok', { n: 1 }, ['careful']]);
    assert.deepEqual([lines[1].result, lines[1].error], ['error', 'boom']);
    assert.equal(process.exitCode, 1);
    process.exitCode = saved;
    rmSync(root, { recursive: true });
  });
});

describe('FileStore', () => {
  test('saves and reads snapshots and history, and lists configs and locales', () => {
    const root = tmp();
    const store = new FileStore(root);
    assert.equal(store.snapshot('ds', 'p'), null, 'missing snapshot is null');
    assert.deepEqual(store.history('ds'), {}, 'missing history is empty');
    store.saveSnapshot('ds', 'p', { entries: [1] });
    store.saveHistory('ds', { p: {} });
    assert.deepEqual(store.snapshot('ds', 'p'), { entries: [1] });
    assert.deepEqual(store.history('ds'), { p: {} });
    mkdirSync(join(root, 'config', 'datasets'), { recursive: true });
    writeFileSync(join(root, 'config', 'datasets', 'b.json'), '{}');
    writeFileSync(join(root, 'config', 'datasets', 'a.json'), '{}');
    assert.deepEqual(store.datasetIds(), ['a', 'b']);
    assert.deepEqual(store.locales(), [], 'no locales folder yet');
    store.publish('x/y.json', { ok: true });
    assert.deepEqual(store.published('x/y.json'), { ok: true });
    assert.throws(() => store.places(), /Missing .*places\.json/);
    rmSync(root, { recursive: true });
  });

  test('saves daily counts one line per place, and reads them back', () => {
    const root = tmp();
    const store = new FileStore(root);
    assert.equal(store.counts('gdelt'), null);
    const data = { first: '2026-09-01', last: '2026-09-02', gaps: ['2026-09-02'], series: { fr: { violence: [0, 1], protest: [3, 0] }, et: { protest: [2, 0], violence: [0, 0] } } };
    store.saveCounts('gdelt', data);
    assert.deepEqual(store.counts('gdelt'), data);
    const lines = readFileSync(join(root, 'data', 'counts', 'gdelt.json'), 'utf8').split('\n');
    assert.deepEqual(lines.slice(1, 3), [' "et": {"protest": [2,0], "violence": [0,0]},', ' "fr": {"protest": [3,0], "violence": [0,1]}']);
    store.saveCounts('empty', { first: null, last: null, gaps: [], series: {} });
    assert.deepEqual(store.counts('empty'), { first: null, last: null, gaps: [], series: {} });
    rmSync(root, { recursive: true });
  });

  test('saves and reads events, signals, the change log by year, and the sources state', () => {
    const root = tmp();
    const store = new FileStore(root);
    assert.equal(store.events('gdacs'), null);
    assert.equal(store.signals(), null);
    assert.deepEqual(store.changes(2026), []);
    assert.deepEqual(store.sourcesState(), {});
    store.saveEvents('gdacs', { events: [1] });
    store.saveSignals({ categories: {} });
    store.saveSourcesState({ us: { lastSuccess: 'x' } });
    store.appendChanges([{ id: 'a', at: '2025-12-31T23:00:00Z' }, { id: 'b', at: '2026-01-01T00:00:00Z' }]);
    store.appendChanges([{ id: 'c', at: '2026-02-01' }]);
    store.archiveEvents('gdacs', [{ id: 'e1', toDate: '2026-03-01T00:00:00Z' }, { id: 'e2', startedAt: '2025-06-01T00:00:00Z' }]);
    assert.deepEqual(store.events('gdacs'), { events: [1] });
    assert.deepEqual(store.signals(), { categories: {} });
    assert.deepEqual(store.sourcesState(), { us: { lastSuccess: 'x' } });
    assert.deepEqual(store.changes(2025).map(c => c.id), ['a']);
    assert.deepEqual(store.changes(2026).map(c => c.id), ['b', 'c'], 'appended, oldest first');
    assert.match(readFileSync(join(root, 'data', 'archive', 'events', 'gdacs', '2026.jsonl'), 'utf8'), /"e1"/);
    assert.match(readFileSync(join(root, 'data', 'archive', 'events', 'gdacs', '2025.jsonl'), 'utf8'), /"e2"/);
    mkdirSync(join(root, 'config', 'sources'), { recursive: true });
    writeFileSync(join(root, 'config', 'sources', 'gdacs.json'), '{"id":"gdacs"}');
    writeFileSync(join(root, 'config', 'categories.json'), '{"categories":[]}');
    writeFileSync(join(root, 'config', 'schedule.json'), '{"gdacs":{"everyMinutes":60}}');
    assert.deepEqual(store.sourceIds(), ['gdacs']);
    assert.deepEqual(store.source('gdacs'), { id: 'gdacs' });
    assert.deepEqual(store.categories(), { categories: [] });
    assert.deepEqual(store.schedule(), { gdacs: { everyMinutes: 60 } });
    rmSync(root, { recursive: true });
  });
});

describe('due check (scripts/due.mjs)', () => {
  const store = { schedule: () => ({ us: { every: 'daily-slot' }, gdacs: { everyMinutes: 60 } }), sourcesState: () => ({ gdacs: { lastSuccess: '2026-09-27T09:20:00Z' } }) };

  test('writes the due ids comma-wrapped for the workflow, with a line per id', () => {
    const r = runDue({ store, env: { SEED: 'tsekhmeistruk/travel-advisor', EVENT: 'schedule' }, now: new Date('2026-09-27T21:17:00Z') });
    assert.equal(r.output, 'due=,us,gdacs,\nany=true\njitter=false\n');
    assert.deepEqual(r.lines, ['run  us: catching up', 'run  gdacs: last success 717 min ago']);
  });
  test('a manual run fetches only what it names', () => {
    const r = runDue({ store, env: { EVENT: 'workflow_dispatch', SOURCES: 'gdacs' }, now: new Date('2026-09-27T09:30:00Z') });
    assert.equal(r.output, 'due=,gdacs,\nany=true\njitter=false\n');
  });
  test('a manual run with "due" behaves like a scheduled one (for an external scheduler)', () => {
    const r = runDue({ store, env: { SEED: 'tsekhmeistruk/travel-advisor', EVENT: 'workflow_dispatch', SOURCES: 'due' }, now: new Date('2026-09-27T09:30:00Z') });
    assert.equal(r.output, 'due=,,\nany=false\njitter=false\n', 'the U.S. slot is at 14:xx and GDACS ran 10 minutes ago');
  });
  test('nothing due gives an empty list', () => {
    const quietStore = { ...store, sourcesState: () => ({ us: { lastSuccess: '2026-09-27T05:00:00Z' }, gdacs: { lastSuccess: '2026-09-27T09:20:00Z' } }) };
    const r = runDue({ store: quietStore, env: {}, now: new Date('2026-09-27T09:30:00Z') });
    assert.equal(r.output, 'due=,,\nany=false\njitter=false\n');
  });
});

describe('runFetch', () => {
  const memoryStore = (initial = null, { events = null, state = {} } = {}) => {
    const saved = {};
    let current = state;
    return {
      saved,
      get state() { return current; },
      snapshot: () => initial, saveSnapshot: (ds, p, snap) => { saved[`${ds}/${p}`] = snap; },
      events: () => events, saveEvents: (id, data) => { saved[`events/${id}`] = data; },
      archiveEvents: (id, list) => { saved[`archive/${id}`] = list; },
      source: (id) => ({ id, lookbackDays: 30 }),
      sourcesState: () => current, saveSourcesState: (s) => { current = s; },
    };
  };
  const provider = (fetchImpl) => ({ id: 'xx', dataset: 'ds', source: 'https://example.test', fetch: fetchImpl });
  const clock = (...times) => { const t = times.map(x => new Date(x)); return () => t.length > 1 ? t.shift() : t[0]; };

  test('records every attempt and the last success in the sources state', async () => {
    const root = tmp();
    const saved = process.exitCode;
    const store = memoryStore({ entries: [] });
    const ok = provider(async () => ({ entries: [{ name: 'a' }, { name: 'b' }], stats: {} }));
    await runFetch(ok, { store, logRoot: root, now: clock('2026-09-27T10:00:00Z', '2026-09-27T10:00:00Z', '2026-09-27T10:00:02Z') });
    assert.deepEqual(store.state.xx, { lastAttempt: '2026-09-27T10:00:00.000Z', lastSuccess: '2026-09-27T10:00:00.000Z', durationMs: 2000, records: 2, consecutiveFailures: 0 });

    const failing = provider(async () => { throw new Error('site down'); });
    await runFetch(failing, { store, logRoot: root, now: clock('2026-09-27T11:00:00Z') });
    await runFetch(failing, { store, logRoot: root, now: clock('2026-09-27T12:00:00Z') });
    assert.deepEqual(store.state.xx, {
      lastAttempt: '2026-09-27T12:00:00.000Z', lastSuccess: '2026-09-27T10:00:00.000Z', durationMs: 0, records: 2, consecutiveFailures: 2, error: 'site down',
    });
    process.exitCode = saved;
    rmSync(root, { recursive: true });
  });

  test('a counts source gets its stored counts and config, and saves the new counts', async () => {
    const root = tmp();
    const saved = {};
    const store = { source: (id) => ({ id }), counts: () => ({ last: '2026-09-26' }), saveCounts: (id, d) => { saved[id] = d; }, sourcesState: () => ({}), saveSourcesState: () => {} };
    let seen;
    const source = { id: 'ct', kind: 'counts', source: 'https://example.test/ct', fetch: async (args) => { seen = args; return { data: { last: '2026-09-27' }, stats: { counted: ['2026-09-27'], gaps: [] } }; } };
    await runFetch(source, { store, logRoot: root, now: clock('2026-09-28T10:00:00Z') });
    assert.deepEqual([seen.previous, seen.config], [{ last: '2026-09-26' }, { id: 'ct' }]);
    assert.deepEqual(saved.ct, { last: '2026-09-27' });
    rmSync(root, { recursive: true });
  });

  test('an events source gets its stored events and config, and keeps its first fetch time', async () => {
    const root = tmp();
    const store = memoryStore(null, { events: { firstFetchedAt: '2026-09-01T00:00:00.000Z', events: [{ id: 'old' }] } });
    let seen;
    const source = { id: 'ev', kind: 'events', source: 'https://example.test/ev', fetch: async (args) => { seen = args; return { events: [{ id: 'new' }], expired: [{ id: 'gone' }], stats: { events: 1 } }; } };
    await runFetch(source, { store, logRoot: root, now: clock('2026-09-27T10:00:00Z') });
    assert.deepEqual(seen.previous, [{ id: 'old' }]);
    assert.deepEqual(seen.config, { id: 'ev', lookbackDays: 30 });
    assert.equal(seen.now.toISOString(), '2026-09-27T10:00:00.000Z');
    assert.deepEqual(store.saved['events/ev'], { source: 'https://example.test/ev', fetchedAt: '2026-09-27T10:00:00.000Z', firstFetchedAt: '2026-09-01T00:00:00.000Z', events: [{ id: 'new' }] });
    assert.deepEqual(store.saved['archive/ev'], [{ id: 'gone' }]);

    const fresh = memoryStore();
    await runFetch({ ...source, fetch: async () => ({ events: [], stats: {} }) }, { store: fresh, logRoot: root, now: clock('2026-09-27T10:00:00Z') });
    assert.equal(fresh.saved['events/ev'].firstFetchedAt, '2026-09-27T10:00:00.000Z', 'the first fetch sets the baseline time');
    assert.equal(fresh.saved['archive/ev'], undefined, 'nothing to archive');
    rmSync(root, { recursive: true });
  });

  test('passes the previous entries in and saves the new snapshot', async () => {
    const root = tmp();
    const store = memoryStore({ entries: [{ name: 'old' }] });
    let seen;
    await runFetch(provider(async ({ previous, today }) => { seen = { previous, today }; return { entries: [{ name: 'new' }], stats: { n: 1 } }; }),
      { store, logRoot: root, now: () => new Date('2026-09-27T10:00:00Z') });
    assert.deepEqual(seen, { previous: [{ name: 'old' }], today: '2026-09-27' });
    assert.deepEqual(store.saved['ds/xx'], { fetchedAt: '2026-09-27T10:00:00.000Z', source: 'https://example.test', entries: [{ name: 'new' }] });
    rmSync(root, { recursive: true });
  });

  test('on failure keeps the previous snapshot, logs the error and sets the exit code', async () => {
    const root = tmp();
    const saved = process.exitCode;
    const store = memoryStore({ entries: [] });
    await runFetch(provider(async () => { throw new Error('site down'); }), { store, logRoot: root });
    assert.deepEqual(store.saved, {}, 'nothing overwritten');
    assert.equal(JSON.parse(readFileSync(logFile(new Date(), root), 'utf8')).error, 'site down');
    assert.equal(process.exitCode, 1);
    process.exitCode = saved;
    rmSync(root, { recursive: true });
  });
});

describe('log summary', () => {
  const ok = { time: '2026-09-27T10:00:00Z', source: 'ca', trigger: 'schedule', result: 'ok', durationMs: 1200,
    calls: { table: { attempts: [{ status: 200 }] }, pages: { requests: 3, statuses: { 200: 2 }, errors: 1, challenges: 0 } },
    stats: { destinations: 230, changed: ['Mexico', 'Japan'], pagesFailed: 1 } };
  const retried = { ...ok, source: 'us', calls: { api: { attempts: [{ status: 429, challenge: true }, { status: 200 }] } }, stats: { advisories: 217, keptFromPrevious: ['Chad'], changeNotes: 140 } };
  const failed = { ...ok, result: 'error', error: 'API failed after 3 attempts', calls: { api: { attempts: [{ error: 'timeout' }] } }, stats: {} };

  test('classifies results', () => {
    assert.equal(result(ok), '✅ OK');
    assert.equal(result(retried), '⚠️ OK after retry');
    assert.equal(result({ ...ok, warnings: ['x'] }), '⚠️ OK with warnings');
    assert.equal(result(failed), '❌ Failed');
  });
  test('summarizes requests', () => {
    assert.equal(callSummary(retried.calls.api), '429 challenge → 200');
    assert.equal(callSummary(ok.calls.pages), '2× 200, 1× error');
    assert.equal(callSummary(failed.calls.api), '✗ timeout');
    assert.equal(callSummary({ requests: 0, statuses: {} }), 'none');
  });
  test('describes what a run produced, for any provider', () => {
    assert.equal(describeRun(ok), '230 destinations · updated: Mexico, Japan · 1 pages failed');
    assert.equal(describeRun(retried), '217 advisories · 1 kept from previous (Chad) · 140 change notes');
    assert.match(describeRun(failed), /Error: API failed/);
    const twoSources = { ...ok, stats: { destinations: 230, sources: ['feed', 'table'], newerThanFeed: ['Mexico'], changed: [] } };
    assert.equal(describeRun(twoSources), '230 destinations (feed + table) · none updated · 1 newer than the feed');
    assert.equal(callSummary({ attempts: [{ status: 200 }] }), '200');
    const dutch = { ...ok, stats: { advisories: 226, severestFallback: ['Irak'], levelChangesPending: 2 } };
    assert.equal(describeRun(dutch), '226 advisories · level by fallback: Irak · 2 level changes awaiting confirmation');
  });
  test('names level changes first, whether applied at once (Canada) or confirmed (U.S., Netherlands)', () => {
    const canada = { ...ok, stats: { destinations: 230, levelChanged: ['Mexico L2 → L3'], changed: ['Mexico'] } };
    assert.equal(describeRun(canada), '230 destinations · 🔔 level changed: Mexico L2 → L3 · updated: Mexico');
    const us = { ...ok, stats: { advisories: 219, levelChangesConfirmed: ['Chad L3 → L4 (first seen 2026-09-26)'] } };
    assert.equal(describeRun(us), '219 advisories · 🔔 level changed: Chad L3 → L4 (first seen 2026-09-26)');
  });
  test('formats durations and keeps table cells on one line', () => {
    assert.equal(duration(1200), '1.2 s');
    assert.equal(duration(125000), '2 m 5 s');
    assert.equal(cell('a | b\nc'), 'a \\| b c');
    assert.equal(cell('x'.repeat(500)).length, 398);
  });
  test('renders the run page table and the recent table', () => {
    const md = renderRunSummary([ok, retried], { labels: { ca: 'CA' }, logLink: { file: 'logs/f.jsonl', url: 'https://x/f' } });
    assert.match(md, /^### Fetch results/);
    assert.match(md, /\| CA \| ✅ OK \|/);
    assert.match(md, /Full log: \[`logs\/f\.jsonl`\]\(https:\/\/x\/f\)/);
    assert.match(renderRunSummary([]), /No fetch ran/);
    assert.match(renderRecent([ok], { days: 7 }), /\| 2026-09-27 10:00 \| schedule \|/);
    assert.match(renderRecent([], { days: 7 }), /No runs logged/);
  });
  test('reads entries across monthly files, newest first, skipping damaged lines', () => {
    const root = tmp();
    mkdirSync(join(root, '2026'), { recursive: true });
    writeFileSync(join(root, '2026', '2026-08.jsonl'), JSON.stringify({ ...ok, time: '2026-08-31T10:00:00Z' }) + '\nnot json\n');
    writeFileSync(join(root, '2026', '2026-09.jsonl'), JSON.stringify(ok) + '\n');
    const entries = readEntries(Date.parse('2026-08-15T00:00:00Z'), { root, now: new Date('2026-09-27T12:00:00Z') });
    assert.deepEqual(entries.map(e => e.time), ['2026-09-27T10:00:00Z', '2026-08-31T10:00:00Z']);
    rmSync(root, { recursive: true });
  });
  test('labels providers with flag emoji and short names, and risk sources by name, from the repo', () => {
    assert.equal(flagEmoji('ca'), '🇨🇦');
    const labels = providerLabels(fileURLToPath(new URL('../../../', import.meta.url)));
    assert.equal(labels.us, '🇺🇸 U.S.');
    assert.equal(labels.ca, '🇨🇦 Canada');
    assert.equal(labels.gdacs, '🌐 GDACS');
  });
  test('renders each source\'s health: status, last success, failures in a row', () => {
    const md = renderHealth({ sources: {
      gdacs: { status: 'healthy', lastSuccess: '2026-09-28T15:37:04.551Z', consecutiveFailures: 0 },
      us: { status: 'error', consecutiveFailures: 3, error: 'API failed | x' },
      who: { status: 'delayed', lastSuccess: '2026-09-27T01:00:00.000Z' },
    } }, { labels: { us: '🇺🇸 U.S.' } });
    assert.match(md, /^### Source health/);
    assert.match(md, /\| gdacs \| ✅ Healthy \| 2026-09-28 15:37 \| 0 \|/);
    assert.match(md, /\| 🇺🇸 U\.S\. \| ❌ Error \| never \| 3 \(API failed \\\| x\) \|/);
    assert.match(md, /\| who \| ⚠️ Delayed \| 2026-09-27 01:00 \| 0 \|/);
    assert.match(renderHealth({}), /No health data yet/);
  });
  test('describes a counts source run: days counted, gaps, or up to date', () => {
    assert.equal(describeRun({ ...ok, stats: { counted: ['2026-09-26', '2026-09-27'], gaps: ['2026-09-20'], through: '2026-09-27' } }),
      '2 day(s) counted, through 2026-09-27 · no file for 2026-09-20');
    assert.equal(describeRun({ ...ok, stats: { counted: [], gaps: [], through: '2026-09-27' } }), 'up to date, through 2026-09-27');
  });
  test('describes a risk source run: events, alert changes first, then new events', () => {
    const gdacs = { ...ok, source: 'gdacs', stats: { events: 13, current: 2, alertChanged: ['gdacs:TC:1 Orange → Red'], added: ['gdacs:EQ:2'], archived: 1 } };
    assert.equal(describeRun(gdacs), '13 events (2 current) · 🔔 alert changed: gdacs:TC:1 Orange → Red · new: gdacs:EQ:2 · 1 archived');
    const many = { ...ok, stats: { events: 20, current: 9, added: Array.from({ length: 9 }, (_, i) => `e${i}`) } };
    assert.equal(describeRun(many), '20 events (9 current) · 9 new');
    assert.equal(callSummary({ requests: 1, statuses: { 204: 1 }, errors: 0, challenges: 0 }), '1× 204');
  });
});

describe('local server', () => {
  let server, url;
  before(async () => { ({ server, url } = await serve(0)); });
  after(() => server.close());

  test('serves the site with the right content types', async () => {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /<title>/);
    assert.match((await fetch(`${url}data/manifest.json`)).headers.get('content-type'), /application\/json/);
    assert.match((await fetch(`${url}js/main.js`)).headers.get('content-type'), /text\/javascript/);
  });
  test('answers 404 for missing files', async () => {
    assert.equal((await fetch(`${url}nope.html`)).status, 404);
  });
  test('never serves files outside site/', async () => {
    for (const path of ['../config/places.json', '..%2fconfig%2fplaces.json', '%2e%2e/%2e%2e/package.json', 'data/..%2f..%2f.github/workflows/deploy.yml']) {
      const res = await fetch(url + path);
      const body = await res.text();
      assert.notEqual(res.status, 200, path);
      assert.ok(!body.includes('"iso2"') && !body.includes('"devDependencies"') && !body.includes('deploy-pages'), `leaked content for ${path}`);
    }
  });
});

test('config files the tests rely on exist', () => {
  for (const f of ['config/places.json', 'config/datasets/travel-advisories.json', 'site/data/manifest.json']) {
    assert.ok(existsSync(new URL(`../../../${f}`, import.meta.url)), f);
  }
});
