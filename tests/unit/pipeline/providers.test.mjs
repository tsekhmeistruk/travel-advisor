// The provider fetchers (network side) against scripted responses: retries, Cloudflare
// challenges, optional sources, page reads. No real network; waits are recorded, not slept.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import us from '../../../scripts/providers/us/index.mjs';
import ca from '../../../scripts/providers/ca/index.mjs';
import { PROVIDERS, getProvider } from '../../../scripts/providers/index.mjs';

const fixture = (f) => readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8');
const CHALLENGE = '<!DOCTYPE html><title>Just a moment...</title>';

// Silence the fetchers' progress output during tests.
let restoreConsole;
before(() => { const { log, warn } = console; console.log = console.warn = () => {}; restoreConsole = () => Object.assign(console, { log, warn }); });
after(() => restoreConsole());

/**
 * A stand-in for the run log: `responses[call]` is a list of responses served in order
 * (or a function of the url). A response is { status, body, challenge } or an Error.
 */
function fakeLog(responses) {
  const log = { warnings: [], requests: [] };
  log.request = async (call, url) => {
    log.requests.push({ call, url });
    const q = responses[call];
    const r = typeof q === 'function' ? q(url) : q.shift();
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return { status, ok: status < 400 && !r.challenge, challenge: !!r.challenge, body: r.body ?? '' };
  };
  log.warn = (m) => log.warnings.push(m);
  return log;
}
const recordSleeps = () => { const waits = []; const sleep = async (ms) => { waits.push(ms); }; return { waits, sleep }; };

describe('provider registry', () => {
  test('lists every provider under its own id', () => {
    for (const [id, p] of Object.entries(PROVIDERS)) {
      assert.equal(p.id, id);
      assert.equal(typeof p.fetch, 'function');
      assert.ok(Array.isArray(p.minorChange) && p.minorChange.every(re => re instanceof RegExp), `${id}.minorChange`);
      assert.match(p.source, /^https:\/\//);
    }
  });
  test('rejects an unknown provider with the list of known ones', () => {
    assert.throws(() => getProvider('xx'), /Unknown provider "xx". Known: us, ca/);
  });
});

describe('U.S. fetcher', () => {
  const realItems = JSON.parse(fixture('us-api.json'));
  // Enough filler advisories to pass the "plausible size" check, plus the real items.
  const apiBody = JSON.stringify([
    ...realItems,
    ...Array.from({ length: 160 }, (_, i) => ({ Title: `Country ${i} - Level 1: Exercise Normal Precautions`, Updated: '2026-09-01T20:00:00-04:00', Link: `https://example.test/${i}` })),
  ]);
  const TODAY = '2026-09-27';

  test('fetches, parses and attaches RSS change notes', async () => {
    const log = fakeLog({ api: [{ body: apiBody }], rss: [{ body: fixture('us-rss.xml') }] });
    const { entries, stats } = await us.fetch({ log, previous: [], today: TODAY, sleep: async () => {} });
    assert.equal(stats.apiItems, realItems.length + 160);
    assert.ok(entries.length >= 160);
    assert.match(entries.find(e => e.name === 'Suriname').change, /no changes to the advisory level/);
    assert.ok(stats.changeNotes >= 1);
    assert.deepEqual(log.warnings, []);
  });

  test('retries a Cloudflare challenge after 1 and 2 minutes, then succeeds', async () => {
    const { waits, sleep } = recordSleeps();
    const log = fakeLog({ api: [{ status: 429, challenge: true }, { body: CHALLENGE, challenge: true }, { body: apiBody }], rss: [{ body: '' }] });
    const { entries } = await us.fetch({ log, previous: [], today: TODAY, sleep });
    assert.ok(entries.length >= 160);
    assert.deepEqual(waits, [60000, 120000]);
  });

  test('gives up after 3 attempts with a clear error', async () => {
    const { waits, sleep } = recordSleeps();
    const log = fakeLog({ api: [{ status: 503 }, { status: 503 }, { status: 503 }] });
    await assert.rejects(us.fetch({ log, previous: [], today: TODAY, sleep }), /API failed after 3 attempts: HTTP 503/);
    assert.deepEqual(waits, [60000, 120000]);
  });

  test('treats a non-JSON answer as a failure and retries', async () => {
    const log = fakeLog({ api: [{ body: '<html>maintenance</html>' }, { body: apiBody }], rss: [{ body: '' }] });
    const { entries } = await us.fetch({ log, previous: [], today: TODAY, sleep: async () => {} });
    assert.ok(entries.length >= 160);
  });

  test('continues without notes when the RSS feed fails', async () => {
    const log = fakeLog({ api: [{ body: apiBody }], rss: [{ status: 500 }] });
    const { stats } = await us.fetch({ log, previous: [], today: TODAY, sleep: async () => {} });
    assert.equal(stats.changeNotes, null);
    assert.match(log.warnings.join(), /RSS change notes unavailable/);
  });

  test('refuses an implausibly small response', async () => {
    const log = fakeLog({ api: [{ body: JSON.stringify(realItems) }] });
    await assert.rejects(us.fetch({ log, previous: [], today: TODAY, sleep: async () => {} }), /Parsed only \d+ advisories/);
  });

  test('warns about outdated copies and keeps the saved entry', async () => {
    const previous = [{ name: 'Bangladesh', level: 2, updated: '2026-08-01', lastSeen: '2026-09-26', url: 'u' }];
    const stale = JSON.stringify([...JSON.parse(apiBody).filter(i => !/Bangladesh/.test(i.Title)),
      { Title: 'Bangladesh - Level 3: Reconsider Travel', Updated: '2026-01-19T19:00:00-05:00', Link: 'old' }]);
    const log = fakeLog({ api: [{ body: stale }], rss: [{ body: '' }] });
    const { entries, stats } = await us.fetch({ log, previous, today: TODAY, sleep: async () => {} });
    assert.equal(entries.find(e => e.name === 'Bangladesh').level, 2);
    assert.equal(stats.staleIgnored, 1);
    assert.match(log.warnings.join(), /Ignored outdated API copies: Bangladesh/);
  });
});

describe('Canada fetcher', () => {
  // A plausible-size table: the real fixture's first row repeated under different names.
  const row = fixture('canada-table.html').match(/<!-- Starting the row -->[\s\S]*?<\/tr>/)[0];
  const table = (n, stamp = '2026-09-24 08:53:35') => '<table><tbody>' + Array.from({ length: n }, (_, i) => row
    .replaceAll('afghanistan', `place-${i}`).replaceAll('Afghanistan', `Place ${i}`)
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/, stamp)).join('\n') + '</tbody></table>';
  const page = fixture('canada-destination.html');

  test('first run reads every destination page', async () => {
    const log = fakeLog({ table: [{ body: table(160) }], pages: () => ({ body: page }) });
    const { entries, stats } = await ca.fetch({ log, previous: [], sleep: async () => {} });
    assert.equal(entries.length, 160);
    assert.equal(entries[0].change, 'Health – editorial change');
    assert.equal(stats.pagesRead, 160);
    assert.equal(stats.changed, '160 (first run)');
  });

  test('later runs reuse notes for unchanged timestamps and read only changed pages', async () => {
    const first = await ca.fetch({ log: fakeLog({ table: [{ body: table(160) }], pages: () => ({ body: page }) }), previous: [], sleep: async () => {} });
    const changedTable = table(160).replace('2026-09-24 08:53:35', '2026-09-27 10:00:00');   // first row only
    const log = fakeLog({ table: [{ body: changedTable }], pages: () => ({ body: page }) });
    const { stats } = await ca.fetch({ log, previous: first.entries, sleep: async () => {} });
    assert.deepEqual(stats.changed, ['Place 0']);
    assert.equal(stats.notesReused, 159);
    assert.equal(log.requests.filter(r => r.call === 'pages').length, 1);
  });

  test('a page that keeps failing is reported but does not fail the run', async () => {
    const { waits, sleep } = recordSleeps();
    const pages = (url) => (url.endsWith('/place-3') ? { status: 500 } : { body: page });
    const log = fakeLog({ table: [{ body: table(160) }], pages });
    const { stats } = await ca.fetch({ log, previous: [], sleep });
    assert.equal(stats.pagesFailed, 1);
    assert.match(log.warnings.join(), /Could not read what changed for: Place 3/);
    assert.ok(waits.includes(1500) && waits.includes(3000), 'retried with backoff');
  });

  test('a page without the "Latest updates" label counts as failed', async () => {
    const log = fakeLog({ table: [{ body: table(160) }], pages: () => ({ body: '<p>redesigned page</p>' }) });
    const { stats } = await ca.fetch({ log, previous: [], sleep: async () => {} });
    assert.equal(stats.pagesFailed, 160);
  });

  test('fails when the table is behind a challenge on every attempt', async () => {
    const log = fakeLog({ table: [{ challenge: true, body: CHALLENGE }, { challenge: true }, { challenge: true }] });
    await assert.rejects(ca.fetch({ log, previous: [], sleep: async () => {} }), /Cloudflare challenge/);
  });

  test('refuses an implausibly small table', async () => {
    const log = fakeLog({ table: [{ body: table(20) }] });
    await assert.rejects(ca.fetch({ log, previous: [], sleep: async () => {} }), /Parsed only 20 destinations/);
  });
});
