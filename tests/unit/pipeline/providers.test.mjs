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
      if (p.minorChangeTypes) assert.ok(p.minorChangeTypes.every(t => typeof t === 'string'), `${id}.minorChangeTypes`);
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

  test('holds an unconfirmed level change and says so in the log', async () => {
    const previous = [{ name: 'Suriname', level: 3, updated: '2026-09-01', lastSeen: '2026-09-26', url: 'u' }];
    const log = fakeLog({ api: [{ body: apiBody }], rss: [{ body: '' }] });   // the API says Level 1
    const { entries, stats } = await us.fetch({ log, previous, today: TODAY, sleep: async () => {} });
    const suriname = entries.find(e => e.name === 'Suriname');
    assert.equal(suriname.level, 3);
    assert.equal(suriname.pending.level, 1);
    assert.equal(stats.levelChangesPending, 1);
    assert.match(log.warnings.join(), /Unconfirmed level changes \(waiting for a later fetch\): Suriname L3 → L1/);
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
  // Plausible-size sources built from real fixtures: the table's first row and the feed's
  // Afghanistan entry, repeated as "Place 0", "Place 1", … with matching URLs.
  const row = fixture('canada-table.html').match(/<!-- Starting the row -->[\s\S]*?<\/tr>/)[0];
  const table = (n, stamp = '2026-09-24 08:53:35') => '<table><tbody>' + Array.from({ length: n }, (_, i) => row
    .replaceAll('afghanistan', `place-${i}`).replaceAll('Afghanistan', `Place ${i}`)
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/, stamp)).join('\n') + '</tbody></table>';
  const af = JSON.parse(fixture('canada-feed.json')).data.AF;
  const feed = (n, patch = () => ({})) => JSON.stringify({
    metadata: { generated: { date: '2026-09-26 02:00:17' } },
    data: Object.fromEntries(Array.from({ length: n }, (_, i) => [`P${i}`, {
      ...af, 'country-iso': `P${i}`, eng: { ...af.eng, name: `Place ${i}`, 'url-slug': `place-${i}` }, ...patch(i),
    }])),
  });
  const page = fixture('canada-destination.html');
  const DOWN = [{ status: 500 }, { status: 500 }, { status: 500 }];
  const run = (responses, previous = [], sleep = async () => {}) => {
    const log = fakeLog(responses);
    return ca.fetch({ log, previous, sleep }).then(r => ({ ...r, log }));
  };
  const pageReads = (log) => log.requests.filter(r => r.call === 'pages').length;

  test('uses the feed for every destination and reads no pages when the table agrees', async () => {
    const { entries, stats, log } = await run({ feed: [{ body: feed(160) }], table: [{ body: table(160) }] });
    assert.equal(entries.length, 160);
    assert.match(entries[0].change, /The Health section was updated/);
    assert.equal(entries[0].changeType, 'Editorial change');
    assert.equal(entries[0].level, 4);
    assert.deepEqual(stats.sources, ['feed', 'table']);
    assert.equal(stats.feedGenerated, '2026-09-26 02:00:17');
    assert.deepEqual(stats.newerThanFeed, []);
    assert.equal(pageReads(log), 0);
    assert.deepEqual(log.warnings, []);
  });

  test('a destination updated since the feed was built takes the table’s data and its page note', async () => {
    const newer = table(160).replace("<div class='do-not-travel'>", "<div class='reconsider-travel'>").replace('2026-09-24 08:53:35', '2026-09-27 10:00:00');
    const { entries, stats, log } = await run({ feed: [{ body: feed(160) }], table: [{ body: newer }], pages: () => ({ body: page }) });
    const p0 = entries.find(e => e.name === 'Place 0');
    assert.equal(p0.level, 3, 'level from the table');
    assert.equal(p0.stamp, '2026-09-27 10:00:00');
    assert.equal(p0.change, 'Health – editorial change', 'note from the page, not the outdated feed');
    assert.equal(p0.changeType, undefined, 'no official type for a page note');
    assert.deepEqual(stats.newerThanFeed, ['Place 0']);
    assert.equal(pageReads(log), 1);
  });

  test('without the feed, falls back to the table and reads the pages it needs', async () => {
    const { entries, stats, log } = await run({ feed: DOWN, table: [{ body: table(160) }], pages: () => ({ body: page }) });
    assert.equal(entries.length, 160);
    assert.equal(entries[0].change, 'Health – editorial change');
    assert.deepEqual(stats.sources, ['table']);
    assert.equal(stats.changed, '160 (first run)');
    assert.equal(pageReads(log), 160);
    assert.match(log.warnings.join(), /Canada feed unavailable .*used the other source/);
  });

  test('table-only runs reuse notes already on file for unchanged timestamps', async () => {
    const first = await run({ feed: DOWN, table: [{ body: table(160) }], pages: () => ({ body: page }) });
    const changedTable = table(160).replace('2026-09-24 08:53:35', '2026-09-27 10:00:00');   // first row only
    const { stats, log } = await run({ feed: DOWN, table: [{ body: changedTable }], pages: () => ({ body: page }) }, first.entries);
    assert.deepEqual(stats.changed, ['Place 0']);
    assert.equal(pageReads(log), 1);
  });

  test('without the table, uses the feed alone', async () => {
    const { entries, stats, log } = await run({ feed: [{ body: feed(160) }], table: [{ challenge: true, body: CHALLENGE }, { challenge: true }, { challenge: true }] });
    assert.equal(entries.length, 160);
    assert.deepEqual(stats.sources, ['feed']);
    assert.match(log.warnings.join(), /Canada table unavailable .*Cloudflare challenge/);
  });

  test('fails only when both sources fail', async () => {
    await assert.rejects(run({ feed: DOWN, table: DOWN }), /Both sources failed\. Canada feed unavailable .* Canada table unavailable/);
  });

  test('an implausibly small or malformed feed counts as unavailable', async () => {
    const small = await run({ feed: [{ body: feed(20) }], table: [{ body: table(160) }], pages: () => ({ body: page }) });
    assert.match(small.log.warnings.join(), /feed unavailable \(only 20 destinations\)/);
    const bad = await run({ feed: [{ body: feed(160, () => ({ 'advisory-state': 7 })) }], table: [{ body: table(160) }], pages: () => ({ body: page }) });
    assert.match(bad.log.warnings.join(), /Unknown advisory-state "7"/);
    const notJson = await run({ feed: [{ body: '<html>maintenance</html>' }], table: [{ body: table(160) }], pages: () => ({ body: page }) });
    assert.deepEqual(notJson.stats.sources, ['table']);
  });

  test('an implausibly small table counts as unavailable', async () => {
    const { log, stats } = await run({ feed: [{ body: feed(160) }], table: [{ body: table(20) }] });
    assert.deepEqual(stats.sources, ['feed']);
    assert.match(log.warnings.join(), /table unavailable \(only 20 destinations; page structure may have changed\)/);
  });

  test('a page that keeps failing is reported but does not fail the run', async () => {
    const { waits, sleep } = recordSleeps();
    const pages = (url) => (url.endsWith('/place-3') ? { status: 500 } : { body: page });
    const { stats, log } = await run({ feed: DOWN, table: [{ body: table(160) }], pages }, [], sleep);
    assert.equal(stats.pagesFailed, 1);
    assert.match(log.warnings.join(), /Could not read what changed for: Place 3/);
    assert.ok(waits.includes(1500) && waits.includes(3000), 'retried with backoff');
  });

  test('a page without the "Latest updates" label counts as failed', async () => {
    const { stats } = await run({ feed: DOWN, table: [{ body: table(160) }], pages: () => ({ body: '<p>redesigned page</p>' }) });
    assert.equal(stats.pagesFailed, 160);
  });
});
