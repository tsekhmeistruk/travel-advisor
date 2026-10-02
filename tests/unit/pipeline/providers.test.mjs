// The provider fetchers (network side) against scripted responses: retries, Cloudflare
// challenges, optional sources. No real network; waits are recorded, not slept.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import us from '../../../scripts/providers/us/index.mjs';
import ca from '../../../scripts/providers/ca/index.mjs';
import nl from '../../../scripts/providers/nl/index.mjs';
import uk from '../../../scripts/providers/uk/index.mjs';
import de from '../../../scripts/providers/de/index.mjs';
import gdacs from '../../../scripts/providers/gdacs/index.mjs';
import who from '../../../scripts/providers/who/index.mjs';
import gdelt from '../../../scripts/providers/gdelt/index.mjs';
import ucdp from '../../../scripts/providers/ucdp/index.mjs';
import { zip } from './zip-helper.mjs';
import { PROVIDERS, SOURCES, getProvider } from '../../../scripts/providers/index.mjs';

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
  log.request = async (call, url, init, opts) => {
    log.requests.push({ call, url, opts });
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
  test('lists every provider and risk source under its own id', () => {
    for (const [id, p] of Object.entries({ ...PROVIDERS, ...SOURCES })) {
      assert.equal(p.id, id);
      assert.equal(typeof p.fetch, 'function');
      assert.match(p.source, /^https:\/\//);
    }
    assert.equal(getProvider('gdacs'), gdacs, 'sources are found by id too');
  });
  test('rejects an unknown provider with the list of known ones', () => {
    assert.throws(() => getProvider('xx'), /Unknown provider "xx". Known: us, ca, nl, uk, de, gdacs, who, gdelt, ucdp$/);
  });
});

describe('GDACS fetcher', () => {
  const fullConfig = JSON.parse(readFileSync(new URL('../../../config/sources/gdacs.json', import.meta.url), 'utf8'));
  // Most tests look at the major (Orange and Red) query alone; the minor one has its own test.
  const config = { ...fullConfig, minor: undefined };
  const body = fixture('gdacs-search.json');
  const NOW = new Date('2026-09-27T16:00:00Z');
  const page = (n) => JSON.stringify({ type: 'FeatureCollection', features: Array.from({ length: n }, (_, i) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { eventtype: 'EQ', eventid: 5000 + i + n * 1000, alertlevel: 'Orange', fromdate: '2026-09-20T00:00:00', todate: '2026-09-20T00:00:00', iscurrent: 'false', affectedcountries: [] },
  })) });

  test('asks for Orange and Red alerts of every configured type over the lookback window', async () => {
    const log = fakeLog({ search: [{ body }] });
    const { events, stats } = await gdacs.fetch({ log, previous: [], now: NOW, config, sleep: async () => {} });
    const url = new URL(log.requests[0].url);
    assert.equal(url.searchParams.get('alertlevel'), 'Orange;Red');
    assert.equal(url.searchParams.get('eventlist'), 'EQ;TC;FL;VO;DR;WF');
    assert.equal(url.searchParams.get('fromDate'), '2026-08-28');
    assert.equal(url.searchParams.get('toDate'), '2026-09-27');
    assert.equal(url.searchParams.get('pageNumber'), '1');
    assert.equal(log.requests[0].opts.detail, false, 'pages are counted, not listed as retries');
    assert.equal(events.length, 13);
    assert.equal(stats.added.length, 13);
    assert.equal(stats.current, events.filter(e => e.current).length);
    assert.deepEqual(log.warnings, []);
  });

  test('pages until a short page, and warns when there are more pages than it reads', async () => {
    const two = fakeLog({ search: [{ body: page(100) }, { body: page(3) }] });
    assert.equal((await gdacs.fetch({ log: two, previous: [], now: NOW, config })).events.length, 103);
    assert.deepEqual(two.requests.map(r => new URL(r.url).searchParams.get('pageNumber')), ['1', '2']);
    const many = fakeLog({ search: () => ({ body: page(100) }) });
    await gdacs.fetch({ log: many, previous: [], now: NOW, config });
    assert.equal(many.requests.length, 5);
    assert.match(many.warnings.join(), /More than 500 major events/);
  });

  test('HTTP 204 means no events; that is only suspicious when events were current before', async () => {
    const quiet = fakeLog({ search: [{ status: 204 }] });
    assert.deepEqual((await gdacs.fetch({ log: quiet, previous: [], now: NOW, config })).events, []);
    assert.deepEqual(quiet.warnings, []);
    const previous = [{ id: 'gdacs:TC:1', code: 'TC', native: { value: 'Orange' }, current: true, toDate: '2026-09-27T00:00:00.000Z', firstSeen: 'x', revisions: [] }];
    const suspicious = fakeLog({ search: [{ status: 204 }] });
    const { events } = await gdacs.fetch({ log: suspicious, previous, now: NOW, config });
    assert.deepEqual(events, previous, 'missing is not ended');
    assert.match(suspicious.warnings.join(), /No events returned/);
  });

  test('warns about event types it has no config for', async () => {
    const log = fakeLog({ search: [{ body: body.replace(/"eventtype":"VO"/, '"eventtype":"XX"') }] });
    await gdacs.fetch({ log, previous: [], now: NOW, config });
    assert.match(log.warnings.join(), /Event types not in config\/sources\/gdacs\.json: XX/);
  });

  test('retries errors and challenge pages after 30 and 60 seconds, then gives up', async () => {
    const { waits, sleep } = recordSleeps();
    const log = fakeLog({ search: [{ status: 503 }, { body: CHALLENGE, challenge: true }, { body }] });
    assert.equal((await gdacs.fetch({ log, previous: [], now: NOW, config, sleep })).events.length, 13);
    assert.deepEqual(waits, [30000, 60000]);
    const down = fakeLog({ search: [new Error('ECONNRESET'), { status: 500 }, { status: 502 }] });
    await assert.rejects(gdacs.fetch({ log: down, previous: [], now: NOW, config, sleep }), /Search failed after 3 attempts: HTTP 502/);
  });

  test('also fetches minor (Green) alerts of the marker types, and keeps them a shorter time after they end', async () => {
    const green = fixture('gdacs-green.json');
    const log = fakeLog({ search: [{ body }, { body: green }] });
    const { events, stats } = await gdacs.fetch({ log, previous: [], now: NOW, config: fullConfig });
    const minor = new URL(log.requests[1].url).searchParams;
    assert.deepEqual([minor.get('alertlevel'), minor.get('eventlist'), minor.get('fromDate')], ['Green', 'TC;FL;VO;WF', '2026-09-20']);
    assert.equal(events.length, 13 + 12);
    assert.ok(events.some(e => e.native.value === 'Green' && e.current));
    assert.equal(stats.received, 25);

    // An ended Green flood older than minor.retainEndedDays is archived; an ended Orange one isn't yet.
    const old = (id, value) => ({ id, code: 'FL', native: { scheme: 'gdacs-alert', value }, current: false, toDate: '2026-09-01T00:00:00.000Z', firstSeen: 'x', revisions: [] });
    const later = fakeLog({ search: [{ status: 204 }, { status: 204 }] });
    const next = await gdacs.fetch({ log: later, previous: [old('gdacs:FL:1', 'Green'), old('gdacs:FL:2', 'Orange')], now: NOW, config: fullConfig });
    assert.deepEqual(next.events.map(e => e.id), ['gdacs:FL:2']);
    assert.deepEqual(next.expired.map(e => e.id), ['gdacs:FL:1']);
    assert.equal(next.stats.archived, 1);
  });

  test('a minor event the API still returns after its retention is neither added nor archived again', async () => {
    // GDACS's window includes events that ended on its first day: an ended Green flood of
    // exactly 14 days ago came back every hour and was archived every hour.
    const oldGreen = JSON.stringify({ type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { eventtype: 'FL', eventid: 1104155, alertlevel: 'Green', fromdate: '2026-09-01T01:00:00', todate: '2026-09-13T01:00:00', iscurrent: 'false', affectedcountries: [] },
    }] });
    const log = fakeLog({ search: [{ status: 204 }, { body: oldGreen }] });
    const { events, expired, stats } = await gdacs.fetch({ log, previous: [], now: NOW, config: fullConfig });
    assert.deepEqual([events.length, expired.length, stats.archived, stats.added], [0, 0, 0, []]);
  });

  test('a malformed response fails the fetch, so the stored events are kept', async () => {
    const { sleep } = recordSleeps();
    const log = fakeLog({ search: [{ body: '{"type":"FeatureCollection"}' }] });
    await assert.rejects(gdacs.fetch({ log, previous: [], now: NOW, config, sleep }), /no list of features/);
  });
});

describe('UK fetcher', () => {
  const index = JSON.parse(fixture('uk-index.json'));
  const pages = JSON.parse(fixture('uk-pages.json'));
  // The real 12 destinations plus fillers, to pass the "plausible size" check.
  const filler = Array.from({ length: 150 }, (_, i) => ({
    api_url: `https://www.gov.uk/api/content/foreign-travel-advice/c${i}`, web_url: `https://www.gov.uk/foreign-travel-advice/c${i}`,
    public_updated_at: '2026-09-01T10:00:00Z', details: { country: { name: `Country ${i}`, slug: `c${i}` } },
  }));
  const indexBody = (children = [...index.links.children, ...filler]) => JSON.stringify({ links: { children } });
  const page = (url) => {
    const slug = url.split('/').at(-1);
    return { body: JSON.stringify(pages[slug] ?? { details: { alert_status: [] } }) };
  };
  const TODAY = '2026-09-28';

  test('the first run reads the index and every page, with levels from the warnings', async () => {
    const log = fakeLog({ index: [{ body: indexBody() }], pages: page });
    const { entries, stats } = await uk.fetch({ log, previous: [], today: TODAY, sleep: async () => {} });
    assert.equal(entries.length, 162);
    assert.equal(log.requests.filter(r => r.call === 'pages').length, 162);
    assert.ok(log.requests.filter(r => r.call === 'pages').every(r => r.opts.detail === false), 'pages are counted, not listed');
    const by = (n) => entries.find(e => e.name === n);
    assert.deepEqual([by('Afghanistan').level, by('Mexico').level, by('Ukraine').level, by('France').level], [4, 2, 3, 1]);
    assert.equal(by('Mexico').regional, true);
    assert.equal(by('France').alerts, undefined);
    assert.equal(by('Mexico').url, 'https://www.gov.uk/foreign-travel-advice/mexico');
    assert.match(by('Mexico').updated, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(stats.levelChanged, []);
  });

  test('later runs read only pages that changed, and report level changes at once', async () => {
    const first = await uk.fetch({ log: fakeLog({ index: [{ body: indexBody() }], pages: page }), previous: [], today: TODAY });
    const later = [...index.links.children, ...filler].map(c => (c.details.country.name === 'Mexico' ? { ...c, public_updated_at: '2026-09-28T08:00:00Z' } : c));
    const log = fakeLog({ index: [{ body: indexBody(later) }], pages: () => ({ body: JSON.stringify({ details: { alert_status: ['avoid_all_travel_to_parts'] } }) }) });
    const { entries, stats } = await uk.fetch({ log, previous: first.entries, today: '2026-09-29' });
    assert.deepEqual(log.requests.filter(r => r.call === 'pages').map(r => r.url), ['https://www.gov.uk/api/content/foreign-travel-advice/mexico']);
    assert.equal(entries.find(e => e.name === 'Mexico').level, 3);
    assert.deepEqual(stats.levelChanged, ['Mexico L2 → L3']);
    assert.deepEqual(stats.changed, ['Mexico']);
    assert.equal(entries.find(e => e.name === 'France').lastSeen, '2026-09-29', 'unchanged entries are kept');
  });

  test('a failed page keeps its previous entry and warns; many failures fail the run', async () => {
    const first = await uk.fetch({ log: fakeLog({ index: [{ body: indexBody() }], pages: page }), previous: [], today: TODAY });
    const later = [...index.links.children, ...filler].map(c => ({ ...c, public_updated_at: '2026-09-28T09:00:00Z' }));
    const { sleep } = recordSleeps();
    const mexicoDown = fakeLog({ index: [{ body: indexBody(later) }], pages: (url) => (url.endsWith('/mexico') ? { status: 503 } : page(url)) });
    const { entries } = await uk.fetch({ log: mexicoDown, previous: first.entries, today: TODAY, sleep });
    assert.equal(entries.find(e => e.name === 'Mexico').level, 2, 'the previous entry');
    assert.match(mexicoDown.warnings.join(), /Pages failed, previous entry kept: Mexico \(pages failed after 3 attempts: HTTP 503\)/);
    const allDown = fakeLog({ index: [{ body: indexBody(later) }], pages: () => ({ status: 500 }) });
    await assert.rejects(uk.fetch({ log: allDown, previous: first.entries, today: TODAY, sleep }), /destination pages failed/);
  });

  test('a small index means the format changed; a failing index fails after retries', async () => {
    await assert.rejects(uk.fetch({ log: fakeLog({ index: [{ body: indexBody(index.links.children) }] }), previous: [], today: TODAY }), /Only 12 destinations/);
    const { waits, sleep } = recordSleeps();
    await assert.rejects(uk.fetch({ log: fakeLog({ index: [{ status: 500 }, { body: CHALLENGE, challenge: true }, { status: 502 }] }), previous: [], today: TODAY, sleep }), /index failed after 3 attempts/);
    assert.deepEqual(waits, [15000, 30000]);
  });
});

describe('Germany fetcher', () => {
  const real = JSON.parse(fixture('germany-warnings.json'));
  // The real 17 plus fillers, to pass the "plausible size" check.
  const body = (edit = (x) => x) => {
    const r = structuredClone(real.response);
    for (let i = 0; i < 150; i++) {
      r.contentList.push(`f${i}`);
      r[`f${i}`] = { countryName: `Land ${i}`, iso3CountryCode: 'TST', lastModified: 1757063288, warning: false, partialWarning: false };
    }
    return JSON.stringify({ response: edit(r) });
  };
  const TODAY = '2026-09-28';

  test('reads every destination in one request', async () => {
    const log = fakeLog({ api: [{ body: body() }] });
    const { entries, stats } = await de.fetch({ log, previous: [], today: TODAY });
    assert.equal(log.requests.length, 1);
    assert.equal(entries.length, 167);
    assert.equal(stats.destinations, 167);
    assert.ok(entries.every(e => e.lastSeen === TODAY));
  });

  test('reports level changes (applied at once) and destinations that changed', async () => {
    const first = (await de.fetch({ log: fakeLog({ api: [{ body: body() }] }), previous: [], today: TODAY })).entries;
    const ghana = real.response.contentList.find(id => real.response[id].iso3CountryCode === 'GHA');
    const later = body(r => ({ ...r, [ghana]: { ...r[ghana], partialWarning: false, warning: true, lastModified: 1790000000 } }));
    const { entries, stats } = await de.fetch({ log: fakeLog({ api: [{ body: later }] }), previous: first, today: '2026-09-29' });
    const name = real.response[ghana].countryName;
    assert.equal(entries.find(e => e.name === name).level, 4);
    assert.deepEqual(stats.levelChanged, [`${name} L3 → L4`]);
    assert.deepEqual(stats.changed, [name]);
  });

  test('a short list means the format changed; errors are retried, then fail', async () => {
    await assert.rejects(de.fetch({ log: fakeLog({ api: [{ body: JSON.stringify(real) }] }), previous: [], today: TODAY }), /Parsed only 17/);
    const { waits, sleep } = recordSleeps();
    await assert.rejects(de.fetch({ log: fakeLog({ api: [{ status: 503 }, { body: CHALLENGE, challenge: true }, { status: 500 }] }), previous: [], today: TODAY, sleep }), /API failed after 3 attempts: HTTP 500/);
    assert.deepEqual(waits, [30000, 60000]);
  });
});

describe('GDELT fetcher', () => {
  const config = JSON.parse(readFileSync(new URL('../../../config/sources/gdelt.json', import.meta.url), 'utf8'));
  const csv = readFileSync(new URL('../../fixtures/gdelt-events.csv', import.meta.url));
  const file = zip('x.export.CSV', csv);
  const NOW = new Date('2026-09-28T12:00:00Z');   // yesterday: 2026-09-27
  const dayOf = (url) => url.match(/(\d{8})\.export/)[1];

  test('the first run starts backfillDays ago, oldest first, and counts at most maxDaysPerRun days', async () => {
    const log = fakeLog({ daily: () => ({ body: file }) });
    const { data, stats } = await gdelt.fetch({ log, previous: null, now: NOW, config: { ...config, backfillDays: 10, maxDaysPerRun: 3 } });
    assert.deepEqual(log.requests.map(r => dayOf(r.url)), ['20260918', '20260919', '20260920']);
    assert.ok(log.requests.every(r => r.opts.binary && r.opts.detail === false));
    assert.deepEqual(stats.counted, ['2026-09-18', '2026-09-19', '2026-09-20']);
    assert.equal(data.series.fr.protest.join(), '5,5,5');
    assert.deepEqual(stats.unmapped, ['OS 6']);
    assert.equal(stats.events, 177);
  });

  test('continues after the last counted day; yesterday not yet published is not an error', async () => {
    const previous = { first: '2026-09-20', last: '2026-09-25', gaps: [], series: {} };
    const log = fakeLog({ daily: (url) => (dayOf(url) === '20260927' ? { status: 404 } : { body: file }) });
    const { data, stats } = await gdelt.fetch({ log, previous, now: NOW, config });
    assert.deepEqual(log.requests.map(r => dayOf(r.url)), ['20260926', '20260927']);
    assert.deepEqual([stats.counted, stats.gaps, data.last], [['2026-09-26'], [], '2026-09-26']);
  });

  test('an older day without a file is a gap; nothing to count is no request', async () => {
    const previous = { first: '2026-09-20', last: '2026-09-22', gaps: [], series: {} };
    const log = fakeLog({ daily: (url) => (dayOf(url) === '20260923' ? { status: 404 } : { body: file }) });
    const { data, stats } = await gdelt.fetch({ log, previous, now: NOW, config: { ...config, maxDaysPerRun: 2 } });
    assert.deepEqual([stats.gaps, stats.counted, data.gaps], [['2026-09-23'], ['2026-09-24'], ['2026-09-23']]);
    const done = fakeLog({ daily: () => { throw new Error('no request expected'); } });
    const same = await gdelt.fetch({ log: done, previous: { ...previous, last: '2026-09-27' }, now: NOW, config });
    assert.deepEqual([done.requests.length, same.stats.counted], [0, []]);
  });

  test('errors are retried, then fail; a file that is not a zip fails', async () => {
    const { waits, sleep } = recordSleeps();
    const previous = { first: '2026-09-20', last: '2026-09-26', gaps: [], series: {} };
    const flaky = fakeLog({ daily: [{ status: 503 }, new Error('ECONNRESET'), { body: file }] });
    assert.deepEqual((await gdelt.fetch({ log: flaky, previous, now: NOW, config, sleep })).stats.counted, ['2026-09-27']);
    assert.deepEqual(waits, [30000, 60000]);
    await assert.rejects(gdelt.fetch({ log: fakeLog({ daily: () => ({ status: 500 }) }), previous, now: NOW, config, sleep }), /Daily file failed after 3 attempts: HTTP 500/);
    await assert.rejects(gdelt.fetch({ log: fakeLog({ daily: () => ({ body: Buffer.from('<html>') }) }), previous, now: NOW, config }), /Not a zip archive/);
  });
});

describe('WHO fetcher', () => {
  const config = JSON.parse(readFileSync(new URL('../../../config/sources/who.json', import.meta.url), 'utf8'));
  const body = fixture('who-don.json');
  const NOW = new Date('2026-09-27T16:00:00Z');

  test('asks for the latest notices in one request and keeps those of the lookback window', async () => {
    const log = fakeLog({ api: [{ body }] });
    const { events, stats } = await who.fetch({ log, previous: [], now: NOW, config, sleep: async () => {} });
    assert.equal(log.requests.length, 1);
    const url = new URL(log.requests[0].url);
    assert.equal(url.searchParams.get('$orderby'), 'PublicationDate desc');
    assert.match(url.searchParams.get('$select'), /DonId,Title/);
    assert.equal(stats.received, 40);
    assert.ok(events.length > 0 && events.length < 40);
    assert.ok(events.every(e => Date.parse(e.startedAt) >= Date.parse('2026-06-29')), '90 days');
    assert.equal(stats.current, 0);
  });

  test('an empty list is an error (WHO publishes every month), so the stored notices are kept', async () => {
    const log = fakeLog({ api: [{ body: '{"value":[]}' }] });
    await assert.rejects(who.fetch({ log, previous: [], now: NOW, config }), /no notices/);
  });

  test('retries errors after 30 and 60 seconds, then gives up', async () => {
    const { waits, sleep } = recordSleeps();
    const log = fakeLog({ api: [{ status: 503 }, { body: CHALLENGE, challenge: true }, { body }] });
    assert.ok((await who.fetch({ log, previous: [], now: NOW, config, sleep })).events.length > 0);
    assert.deepEqual(waits, [30000, 60000]);
    const down = fakeLog({ api: [{ status: 500 }, new Error('ECONNRESET'), { status: 502 }] });
    await assert.rejects(who.fetch({ log: down, previous: [], now: NOW, config, sleep }), /API failed after 3 attempts: HTTP 502/);
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

  test('fetches and parses the API in one request (levels only, no change notes)', async () => {
    const log = fakeLog({ api: [{ body: apiBody }] });
    const { entries, stats } = await us.fetch({ log, previous: [], today: TODAY, sleep: async () => {} });
    assert.equal(stats.apiItems, realItems.length + 160);
    assert.ok(entries.length >= 160);
    assert.deepEqual(log.requests.map(r => r.call), ['api']);
    assert.ok(entries.every(e => !('change' in e)));
    assert.deepEqual(log.warnings, []);
  });

  test('retries a Cloudflare challenge after 1 and 2 minutes, then succeeds', async () => {
    const { waits, sleep } = recordSleeps();
    const log = fakeLog({ api: [{ status: 429, challenge: true }, { body: CHALLENGE, challenge: true }, { body: apiBody }] });
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
    const log = fakeLog({ api: [{ body: '<html>maintenance</html>' }, { body: apiBody }] });
    const { entries } = await us.fetch({ log, previous: [], today: TODAY, sleep: async () => {} });
    assert.ok(entries.length >= 160);
  });

  test('refuses an implausibly small response', async () => {
    const log = fakeLog({ api: [{ body: JSON.stringify(realItems) }] });
    await assert.rejects(us.fetch({ log, previous: [], today: TODAY, sleep: async () => {} }), /Parsed only \d+ advisories/);
  });

  test('holds an unconfirmed level change and says so in the log', async () => {
    const previous = [{ name: 'Suriname', level: 3, updated: '2026-09-01', lastSeen: '2026-09-26', url: 'u' }];
    const log = fakeLog({ api: [{ body: apiBody }] });   // the API says Level 1
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
    const log = fakeLog({ api: [{ body: stale }] });
    const { entries, stats } = await us.fetch({ log, previous, today: TODAY, sleep: async () => {} });
    assert.equal(entries.find(e => e.name === 'Bangladesh').level, 2);
    assert.equal(stats.staleIgnored, 1);
    assert.match(log.warnings.join(), /Ignored outdated API copies: Bangladesh/);
  });
});

describe('Netherlands fetcher', () => {
  // A plausible-size list: the real Spain entry repeated under different names and codes.
  const spain = JSON.parse(fixture('netherlands-list.json')).find(d => d.isocode === 'ESP');
  const doc = (i, patch = {}) => ({ ...spain, location: `Land ${i}`, isocode: `X${String(i).padStart(2, '0')}`, ...patch });
  const page = (from, n, patch) => ({ body: JSON.stringify(Array.from({ length: n }, (_, k) => doc(from + k, patch?.(from + k)))) });
  const TODAY = '2026-09-27';
  const run = (responses, previous = [], sleep = async () => {}) => {
    const log = fakeLog(responses);
    return nl.fetch({ log, previous, today: TODAY, sleep }).then(r => ({ ...r, log }));
  };

  test('pages through the list until a short page', async () => {
    const { entries, stats, log } = await run({ list: [page(0, 200), page(200, 26)] });
    assert.equal(entries.length, 226);
    assert.equal(stats.advisories, 226);
    assert.deepEqual(log.requests.map(r => new URL(r.url).searchParams.get('offset')), ['0', '200']);
    assert.equal(entries[0].level, 1);
    // Pages are counted, not listed as attempts, so the run log doesn't report them as a retry.
    assert.ok(log.requests.every(r => r.opts?.detail === false));
  });

  test('holds a level change until a later fetch confirms it (levels come from prose)', async () => {
    const previous = [{ name: 'Land 0', level: 1, updated: '2026-09-15', lastSeen: '2026-09-26', url: 'u', iso: 'X00' }];
    const redSummary = '<p>De kleurcode van het reisadvies voor Land 0 is rood.</p>';
    const { entries, stats, log } = await run({ list: [page(0, 170, i => (i === 0 ? { introduction: redSummary, lastmodified: '2026-09-27T08:00:00Z' } : {}))] }, previous);
    const land0 = entries.find(e => e.name === 'Land 0');
    assert.equal(land0.level, 1);
    assert.equal(land0.pending.level, 4);
    assert.equal(stats.levelChangesPending, 1);
    assert.match(log.warnings.join(), /Unconfirmed level changes .*Land 0 L1 → L4/);
  });

  test('warns about summaries without a colour, and when the fallback rule suddenly dominates', async () => {
    const vague = '<p>De kleurcode is rood voor het noorden en oranje voor het zuiden.</p>';
    const { stats, log } = await run({ list: [page(0, 170, i => (i < 12 ? { introduction: vague } : i === 12 ? { introduction: '<p>Geen kleur.</p>' } : {}))] });
    assert.equal(stats.severestFallback.length, 12);
    assert.match(log.warnings.join(), /No colour code found in the summary of: Land 12/);
    assert.match(log.warnings.join(), /12 summaries needed the most-severe-colour fallback/);
  });

  test('retries and then fails with a clear error', async () => {
    const { waits, sleep } = recordSleeps();
    await assert.rejects(run({ list: [{ status: 502 }, { challenge: true }, { status: 502 }] }, [], sleep), /List failed after 3 attempts: HTTP 502/);
    assert.deepEqual(waits, [30000, 60000]);
  });

  test('treats a non-JSON answer as a failure and retries', async () => {
    const { entries } = await run({ list: [{ body: '<html>onderhoud</html>' }, page(0, 170)] });
    assert.equal(entries.length, 170);
  });

  test('refuses an implausibly small list', async () => {
    await assert.rejects(run({ list: [page(0, 40)] }), /Parsed only 40 advisories/);
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
  const DOWN = [{ status: 500 }, { status: 500 }, { status: 500 }];
  const run = (responses, previous = [], sleep = async () => {}) => {
    const log = fakeLog(responses);
    return ca.fetch({ log, previous, sleep }).then(r => ({ ...r, log }));
  };
  const calls = (log) => log.requests.map(r => r.call);

  test('uses the feed for every destination, in two requests (feed and table, no pages)', async () => {
    const { entries, stats, log } = await run({ feed: [{ body: feed(160) }], table: [{ body: table(160) }] });
    assert.equal(entries.length, 160);
    assert.equal(entries[0].level, 4);
    assert.ok(entries.every(e => !('change' in e) && !('changeType' in e)));
    assert.deepEqual(stats.sources, ['feed', 'table']);
    assert.equal(stats.feedGenerated, '2026-09-26 02:00:17');
    assert.deepEqual(stats.newerThanFeed, []);
    assert.deepEqual(calls(log), ['feed', 'table']);
    assert.deepEqual(log.warnings, []);
  });

  test('a destination updated since the feed was built takes the table’s level and date', async () => {
    const newer = table(160).replace("<div class='do-not-travel'>", "<div class='reconsider-travel'>").replace('2026-09-24 08:53:35', '2026-09-27 10:00:00');
    const { entries, stats, log } = await run({ feed: [{ body: feed(160) }], table: [{ body: newer }] });
    const p0 = entries.find(e => e.name === 'Place 0');
    assert.equal(p0.level, 3, 'level from the table');
    assert.equal(p0.stamp, '2026-09-27 10:00:00');
    assert.deepEqual(stats.newerThanFeed, ['Place 0']);
    assert.deepEqual(calls(log), ['feed', 'table']);
  });

  test('without the feed, retries it with backoff, then uses the table alone', async () => {
    const { waits, sleep } = recordSleeps();
    const { entries, stats, log } = await run({ feed: DOWN, table: [{ body: table(160) }] }, [], sleep);
    assert.equal(entries.length, 160);
    assert.deepEqual(stats.sources, ['table']);
    assert.equal(stats.changed, '160 (first run)');
    assert.deepEqual(waits, [1500, 3000]);
    assert.match(log.warnings.join(), /Canada feed unavailable .*used the other source/);
  });

  test('reports which destinations changed their timestamp since the previous run', async () => {
    const first = await run({ feed: DOWN, table: [{ body: table(160) }] });
    const changedTable = table(160).replace('2026-09-24 08:53:35', '2026-09-27 10:00:00');   // first row only
    const { stats } = await run({ feed: DOWN, table: [{ body: changedTable }] }, first.entries);
    assert.deepEqual(stats.changed, ['Place 0']);
    assert.deepEqual(stats.levelChanged, [], 'a new date alone is not a level change');
  });

  test('reports level changes since the previous run, applied at once (official levels)', async () => {
    const first = await run({ feed: [{ body: feed(160) }], table: DOWN });
    assert.deepEqual(first.stats.levelChanged, [], 'nothing to compare on a first run');
    const lowered = feed(160, i => (i === 2 ? { 'advisory-state': 2 } : {}));
    const { entries, stats } = await run({ feed: [{ body: lowered }], table: DOWN }, first.entries);
    assert.equal(entries.find(e => e.name === 'Place 2').level, 3);
    assert.deepEqual(stats.levelChanged, ['Place 2 L4 → L3']);
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
    const small = await run({ feed: [{ body: feed(20) }], table: [{ body: table(160) }] });
    assert.match(small.log.warnings.join(), /feed unavailable \(only 20 destinations\)/);
    const bad = await run({ feed: [{ body: feed(160, () => ({ 'advisory-state': 7 })) }], table: [{ body: table(160) }] });
    assert.match(bad.log.warnings.join(), /Unknown advisory-state "7"/);
    const notJson = await run({ feed: [{ body: '<html>maintenance</html>' }], table: [{ body: table(160) }] });
    assert.deepEqual(notJson.stats.sources, ['table']);
  });

  test('an implausibly small table counts as unavailable', async () => {
    const { log, stats } = await run({ feed: [{ body: feed(160) }], table: [{ body: table(20) }] });
    assert.deepEqual(stats.sources, ['feed']);
    assert.match(log.warnings.join(), /table unavailable \(only 20 destinations; page structure may have changed\)/);
  });
});

describe('UCDP fetcher', () => {
  const config = JSON.parse(readFileSync(new URL('../../../config/sources/ucdp.json', import.meta.url), 'utf8'));
  const csv = fixture('ucdp-ged.csv');
  const NOW = new Date('2026-10-02T06:00:00Z');   // September's file may be out; October's can't be
  const versionOf = (url) => url.match(/GEDEvent_v(\d+)_0_(\d+)\.csv$/).slice(1).join('.0.');

  test('the first run starts at backfillFrom, oldest first, at most maxVersionsPerRun', async () => {
    const log = fakeLog({ version: () => ({ body: csv }) });
    const { versions, stats } = await ucdp.fetch({ log, versions: [], now: NOW, config: { ...config, backfillFrom: '25.0.11', maxVersionsPerRun: 3 } });
    assert.deepEqual(log.requests.map(r => versionOf(r.url)), ['25.0.11', '25.0.12', '26.0.1']);
    assert.ok(log.requests.every(r => r.opts.detail === false && !r.opts.binary));
    assert.deepEqual(versions.map(v => [v.version, v.month, v.fetchedAt, v.events.length]), [
      ['25.0.11', '2025-11', NOW.toISOString(), 22], ['25.0.12', '2025-12', NOW.toISOString(), 22], ['26.0.1', '2026-01', NOW.toISOString(), 22]]);
    assert.equal(versions[0].malformed, undefined, 'not stored');
    assert.deepEqual([stats.fetched, stats.through, stats.events, stats.unmapped], [['25.0.11', '25.0.12', '26.0.1'], '26.0.1', 66, []]);
  });

  test('continues after the last stored version; a 404 means "not out yet"; no month is asked before it is over', async () => {
    const log = fakeLog({ version: (url) => (versionOf(url) === '26.0.9' ? { status: 404 } : { body: csv }) });
    const { versions, stats } = await ucdp.fetch({ log, versions: ['26.0.7'], now: NOW, config });
    assert.deepEqual(log.requests.map(r => versionOf(r.url)), ['26.0.8', '26.0.9'], 'October (26.0.10) is never tried in October');
    assert.deepEqual([versions.map(v => v.version), stats.through, stats.skipped], [['26.0.8'], '26.0.8', []]);
    const none = fakeLog({ version: [{ status: 404 }] });
    const quiet = await ucdp.fetch({ log: none, versions: ['26.0.8'], now: NOW, config });
    assert.deepEqual([quiet.versions, quiet.stats.through, none.requests.length], [[], '26.0.8', 1]);
    const done = fakeLog({ version: () => { throw new Error('no request expected'); } });
    assert.deepEqual((await ucdp.fetch({ log: done, versions: ['26.0.9'], now: NOW, config })).versions, [], 'September stored: nothing to ask in October');
  });

  test('a month that never came out is skipped when the next one exists', async () => {
    const log = fakeLog({ version: (url) => (versionOf(url) === '26.0.6' ? { status: 404 } : { body: csv }) });
    const { versions, stats } = await ucdp.fetch({ log, versions: ['26.0.5'], now: NOW, config: { ...config, maxVersionsPerRun: 2 } });
    assert.deepEqual(versions.map(v => v.version), ['26.0.7', '26.0.8']);
    assert.deepEqual(stats.skipped, ['26.0.6']);
    assert.ok(log.warnings.some(w => /never came out: 26\.0\.6/.test(w)));
  });

  test('countries missing from the config are reported; errors are retried, then fail; another format fails', async () => {
    const log = fakeLog({ version: [{ body: csv }, { status: 404 }] });
    const { stats } = await ucdp.fetch({ log, versions: ['26.0.7'], now: NOW, config: { ...config, countries: { Ukraine: 'ua' } } });
    assert.ok(stats.unmapped.includes('Mexico') && !stats.unmapped.includes('Ukraine'));
    assert.ok(log.warnings.some(w => w.startsWith('UCDP countries not in config/sources/ucdp.json: ')));
    const { waits, sleep } = recordSleeps();
    const flaky = fakeLog({ version: [{ status: 503 }, new Error('ECONNRESET'), { body: csv }, { status: 404 }] });
    assert.deepEqual((await ucdp.fetch({ log: flaky, versions: ['26.0.7'], now: NOW, config, sleep })).stats.fetched, ['26.0.8']);
    assert.deepEqual(waits, [30000, 60000]);
    await assert.rejects(ucdp.fetch({ log: fakeLog({ version: () => ({ status: 500 }) }), versions: ['26.0.7'], now: NOW, config, sleep }), /UCDP 26\.0\.8 failed after 3 attempts: HTTP 500/);
    await assert.rejects(ucdp.fetch({ log: fakeLog({ version: () => ({ body: '<html>' }) }), versions: ['26.0.7'], now: NOW, config }), /not in the expected format/);
  });
});
