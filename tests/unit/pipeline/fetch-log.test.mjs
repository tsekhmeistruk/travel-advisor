import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startRunLog, logFile } from '../../../scripts/lib/fetch-log.mjs';

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
