import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunLog, withRunLog, logFile, currentRun, currentTrigger } from '../../../scripts/lib/fetch-log.mjs';
import { FileStore } from '../../../scripts/lib/store.mjs';
import { SqliteStore } from '../../../scripts/lib/sqlite-store.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// A fetch stub that returns the given responses in order.
function stubFetch(...responses) {
  let i = 0;
  globalThis.fetch = async () => {
    const r = responses[i++];
    if (r instanceof Error) throw r;
    return new Response(r.body ?? '', { status: r.status ?? 200, headers: r.headers ?? {} });
  };
}

const CLOUDFLARE_PAGE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>challenges.cloudflare.com</body></html>';

describe('startRunLog().request', () => {
  test('records each attempt with status and timing', async () => {
    stubFetch({ status: 429, headers: { 'retry-after': '60' } }, { status: 200, body: '[]' });
    const log = startRunLog('us');
    await log.request('api', 'https://example.test/api');
    const res = await log.request('api', 'https://example.test/api');
    assert.equal(res.ok, true);
    assert.equal(res.body, '[]');
  });

  test('detects a Cloudflare challenge page even with HTTP 200', async () => {
    stubFetch({ status: 200, body: CLOUDFLARE_PAGE });
    const res = await startRunLog('us').request('api', 'https://example.test/api');
    assert.equal(res.challenge, true);
    assert.equal(res.ok, false, 'a challenge page must not count as a successful response');
  });

  test('records network errors and rethrows them', async () => {
    stubFetch(new TypeError('fetch failed'));
    await assert.rejects(startRunLog('us').request('api', 'https://example.test/api'), /fetch failed/);
  });
});

test('log files are grouped by year and month', () => {
  assert.match(logFile(new Date('2026-09-27T10:00:00Z')).replaceAll('\\', '/'), /logs\/fetch\/2026\/2026-09\.jsonl$/);
});

describe('where the line goes', () => {
  const stores = { FileStore: (root) => new FileStore(root), SqliteStore: (root) => new SqliteStore(':memory:', { root }) };
  for (const [name, make] of Object.entries(stores)) {
    test(`through the store's fetch runs (${name})`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'trm-log-'));
      const store = make(root);
      stubFetch({ status: 200, body: '[]' });
      const log = startRunLog('us', { store, env: {} });
      await log.request('api', 'https://example.test/api');
      log.stat({ advisories: 2 });
      log.write();
      const saved = process.exitCode;
      await withRunLog('ca', async () => { throw new Error('boom'); }, { store, env: { RUN_ID: 'job-7', RUN_TRIGGER: 'schedule' } });
      process.exitCode = saved;
      const [us, ca] = store.fetchRuns();
      assert.deepEqual([us.source, us.run, us.trigger, us.result, us.stats, us.calls.api.attempts[0].status], ['us', 'local', 'local', 'ok', { advisories: 2 }, 200]);
      assert.deepEqual([ca.source, ca.run, ca.trigger, ca.result, ca.error], ['ca', 'job-7', 'schedule', 'error', 'boom']);
      store.close();
      rmSync(root, { recursive: true });
    });
  }

  test('a log folder given by name wins over the store', () => {
    const root = mkdtempSync(join(tmpdir(), 'trm-log-'));
    const store = { appendFetchRun: () => assert.fail('not the store') };
    startRunLog('us', { root, store }).write();
    assert.equal(JSON.parse(readFileSync(logFile(new Date(), root), 'utf8')).source, 'us');
    rmSync(root, { recursive: true });
  });
});

describe('the run and its trigger', () => {
  test('the backend\'s job, then a GitHub Actions run, then "local"', () => {
    assert.equal(currentRun({ RUN_ID: 'job-7', GITHUB_RUN_ID: '123' }), 'job-7');
    assert.equal(currentRun({ GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' }), '123.2');
    assert.equal(currentRun({ GITHUB_RUN_ID: '123' }), '123.1');
    assert.equal(currentRun({}), 'local');
    assert.equal(currentTrigger({ RUN_TRIGGER: 'manual', GITHUB_EVENT_NAME: 'schedule' }), 'manual');
    assert.equal(currentTrigger({ GITHUB_EVENT_NAME: 'schedule' }), 'schedule');
    assert.equal(currentTrigger({}), 'local');
  });
});
