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
import { readEntries, renderRunSummary, renderRecent, result, callSummary, describe as describeRun, duration, cell, flagEmoji, providerLabels } from '../../../scripts/lib/log-summary.mjs';
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
});

describe('runFetch', () => {
  const memoryStore = (initial = null) => {
    const saved = {};
    return { saved, snapshot: () => initial, saveSnapshot: (ds, p, snap) => { saved[`${ds}/${p}`] = snap; } };
  };
  const provider = (fetchImpl) => ({ id: 'xx', dataset: 'ds', source: 'https://example.test', fetch: fetchImpl });

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
    assert.equal(describeRun(ok), '230 destinations · changed: Mexico, Japan · 1 pages failed');
    assert.equal(describeRun(retried), '217 advisories · 1 kept from previous (Chad) · 140 change notes');
    assert.match(describeRun(failed), /Error: API failed/);
    const twoSources = { ...ok, stats: { destinations: 230, sources: ['feed', 'table'], newerThanFeed: ['Mexico'], changed: [] } };
    assert.equal(describeRun(twoSources), '230 destinations (feed + table) · none changed · 1 newer than the feed');
    assert.equal(callSummary({ attempts: [{ status: 200 }] }), '200');
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
  test('labels providers with flag emoji and short names from the repo', () => {
    assert.equal(flagEmoji('ca'), '🇨🇦');
    const labels = providerLabels(fileURLToPath(new URL('../../../', import.meta.url)));
    assert.equal(labels.us, '🇺🇸 U.S.');
    assert.equal(labels.ca, '🇨🇦 Canada');
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
