// Markers-only event sources: USGS earthquakes and NASA EONET volcanoes (scripts/providers/usgs,
// scripts/providers/eonet), with real responses cut to a few features (tests/fixtures/, Oct 2,
// 2026), and how the risk layer shows them: map markers that never set a level, each shown once
// when GDACS reports the same event.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseQuakes, parseQuake } from '../../../scripts/providers/usgs/parse.mjs';
import { parseEvents as parseEonet } from '../../../scripts/providers/eonet/parse.mjs';
import usgs from '../../../scripts/providers/usgs/index.mjs';
import eonet from '../../../scripts/providers/eonet/index.mjs';
import { buildRisk, distanceKm, isDuplicate } from '../../../scripts/lib/risk.mjs';
import { placeIndex } from '../../../scripts/lib/build.mjs';

const fixture = (f) => readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8');
const config = (id) => JSON.parse(readFileSync(new URL(`../../../config/sources/${id}.json`, import.meta.url), 'utf8'));
const QUAKES = fixture('usgs-quakes.json');
const VOLCANOES = fixture('eonet-volcanoes.json');
const NOW = new Date('2026-10-02T12:00:00Z');
const fakeLog = (body, status = 200) => {
  const log = { warnings: [], requests: [], warn: (m) => log.warnings.push(m) };
  log.request = async (call, url, init) => {
    log.requests.push({ call, url, init });
    const r = typeof body === 'function' ? body() : { body, status };
    if (r instanceof Error) throw r;
    return { status: r.status ?? 200, ok: (r.status ?? 200) < 400, body: r.body ?? '' };
  };
  return log;
};

describe('USGS earthquakes', () => {
  test('each quake: its magnitude class, place, depth, time and page; the country from the place, none at sea', () => {
    const q = parseQuakes(QUAKES);
    assert.equal(q.length, 5);
    assert.deepEqual(q[0], {
      id: 'usgs:us6000tz62', code: 'EQ', name: 'M 5.8 - 165 km SSE of Vilyuchinsk, Russia', country: 'Russia', iso3: [],
      point: { lon: 159.74, lat: 51.687 }, native: { scheme: 'usgs-magnitude', value: 'M5' }, magnitude: 5.8,
      severity: 'Magnitude 5.8 mww, depth 29 km', startedAt: q[0].startedAt, toDate: q[0].startedAt, current: false,
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000tz62',
    });
    assert.match(q[0].startedAt, /^2026-10-0\dT/);
    assert.equal(q[1].country, undefined, 'south of the Fiji Islands: at sea');
    assert.equal(q[3].country, 'Alaska', 'a U.S. state (an alias in the config)');
  });

  test('a response that isn\'t a list, or a quake without its facts, fails', () => {
    assert.throws(() => parseQuakes('<html>'), /not JSON/);
    assert.throws(() => parseQuakes('{"type":"FeatureCollection"}'), /no list of features/);
    assert.throws(() => parseQuake({ id: 'x', properties: { mag: 5 }, geometry: { type: 'Point', coordinates: [1, 2] } }), /without id, magnitude, time or point/);
    assert.deepEqual(parseQuakes(JSON.stringify({ features: [{ id: 'b', properties: { type: 'quarry blast', mag: 2 } }] })), [], 'not an earthquake: left out');
    const big = parseQuake({ id: 'z', properties: { mag: 9.4, time: Date.parse('2026-10-01T00:00:00Z'), place: 'off the coast' }, geometry: { type: 'Point', coordinates: [140, 38] } });
    assert.deepEqual([big.native.value, big.name, big.severity], ['M9', 'M 9.4 - off the coast', 'Magnitude 9.4']);
  });

  test('the fetcher keeps magnitude 5 and above, merges with the stored quakes, and retries', async () => {
    const log = fakeLog(QUAKES);
    const { events, expired, stats } = await usgs.fetch({ log, previous: [], now: NOW, config: config('usgs') });
    assert.deepEqual(events.map(e => e.id).sort(), ['usgs:us6000tyzi', 'usgs:us6000tz62'], 'M5.8 Russia and M5.0 Fiji; not the M4.5–4.8 ones');
    assert.ok(events.every(e => !('magnitude' in e)), 'the magnitude is in the native value and the severity');
    assert.ok(events.every(e => e.native.value >= 'M5'));
    assert.deepEqual([stats.received, stats.events, expired.length], [events.length, events.length, 0]);
    assert.match(log.requests[0].url, /4\.5_week\.geojson$/);
    assert.match(log.requests[0].init.headers['User-Agent'], /^RiskMonitor/);
    const waits = [];
    let n = 0;
    const flaky = fakeLog(() => (n++ < 1 ? { status: 503 } : { body: QUAKES }));
    await usgs.fetch({ log: flaky, previous: [], now: NOW, config: config('usgs'), sleep: async (ms) => waits.push(ms) });
    assert.deepEqual(waits, [20000]);
    await assert.rejects(usgs.fetch({ log: fakeLog('', 500), previous: [], now: NOW, config: config('usgs'), sleep: async () => {} }), /USGS feed failed after 3 attempts: HTTP 500/);
  });
});

describe('NASA EONET volcanoes', () => {
  test('one event per volcano: its first date, its latest point, the country from the title, an https link; only volcanoes', () => {
    const v = parseEonet(VOLCANOES);
    assert.equal(v.length, 3, 'the storm is left out');
    const chillan = v.find(e => e.id === 'eonet:EONET_20710');
    assert.deepEqual(chillan, {
      id: 'eonet:EONET_20710', code: 'VO', name: 'Nevados del Chillan Volcano, Chile', country: 'Chile', iso3: [],
      point: { lon: -71.378, lat: -36.868 }, native: { scheme: 'eonet-status', value: 'open' },
      startedAt: '2026-06-15T00:00:00.000Z', toDate: '2026-06-15T00:00:00.000Z', current: true, url: 'https://volcano.si.edu/volcano.cfm?vn=357070',
    });
    assert.match(v.find(e => e.id === 'eonet:EONET_6175').url, /^https:\/\/volcano\.si\.edu\//, 'an http link made https');
  });

  test('several reports of one volcano: the latest point and date, the first start; a closed one has ended', () => {
    const json = JSON.parse(VOLCANOES);
    const base = json.features.find(f => f.properties.id === 'EONET_20710');
    const later = { ...base, properties: { ...base.properties, date: '2026-09-01T00:00:00Z' }, geometry: { type: 'Point', coordinates: [-71.4, -36.9] } };
    const earlier = { ...base, properties: { ...base.properties, date: '2026-01-01T00:00:00Z' } };
    const [e] = parseEonet(JSON.stringify({ features: [base, later, earlier] }));
    assert.deepEqual([e.startedAt, e.toDate, e.point], ['2026-01-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', { lon: -71.4, lat: -36.9 }]);
    const closed = { ...base, properties: { ...base.properties, closed: '2026-09-20T00:00:00Z' } };
    const [c] = parseEonet(JSON.stringify({ features: [closed] }));
    assert.deepEqual([c.current, c.toDate, c.native.value], [false, '2026-09-20T00:00:00.000Z', 'closed']);
    assert.throws(() => parseEonet('nope'), /not JSON/);
    assert.throws(() => parseEonet('{}'), /no list of features/);
    assert.throws(() => parseEonet(JSON.stringify({ features: [{ properties: { id: 'x' } }] })), /without id, title, date or point/);
  });

  test('the fetcher: a volcano no longer listed has ended; the request asks for open volcanoes only', async () => {
    const gone = { id: 'eonet:EONET_1', code: 'VO', name: 'Old Volcano, Peru', native: { scheme: 'eonet-status', value: 'open' }, startedAt: '2026-01-01T00:00:00.000Z', toDate: '2026-02-01T00:00:00.000Z', current: true, iso3: [], firstSeen: '2026-02-01T00:00:00.000Z', revisions: [] };
    const log = fakeLog(VOLCANOES);
    const { events, stats } = await eonet.fetch({ log, previous: [gone], now: NOW, config: config('eonet') });
    assert.match(log.requests[0].url, /status=open&category=volcanoes$/);
    const old = events.find(e => e.id === 'eonet:EONET_1');
    assert.deepEqual([old.current, old.toDate], [false, NOW.toISOString()], 'ended now: kept for retainEndedDays');
    assert.deepEqual([stats.received, stats.current], [3, 3]);
    await assert.rejects(eonet.fetch({ log: fakeLog('', 502), previous: [], now: NOW, config: config('eonet'), sleep: async () => {} }), /EONET failed after 3 attempts: HTTP 502/);
  });
});

describe('markers in the risk layer', () => {
  test('distances and duplicates: the same type, close (and close in time, when the rule says)', () => {
    assert.equal(Math.round(distanceKm({ lon: 0, lat: 0 }, { lon: 1, lat: 0 })), 111);
    assert.equal(distanceKm({ lon: 10, lat: 50 }, { lon: 10, lat: 50 }), 0);
    const gdacs = [{ type: 'earthquake', point: { lon: 159.7, lat: 51.7 }, startedAt: '2026-10-01T10:00:00.000Z' }];
    const quake = { type: 'earthquake', point: { lon: 159.74, lat: 51.687 }, startedAt: '2026-10-01T10:30:00.000Z' };
    const rule = { km: 100, hours: 2 };
    assert.equal(isDuplicate(quake, gdacs, rule), true);
    assert.equal(isDuplicate({ ...quake, startedAt: '2026-10-01T14:00:00.000Z' }, gdacs, rule), false, 'four hours later: another quake');
    assert.equal(isDuplicate({ ...quake, type: 'volcano' }, gdacs, rule), false);
    assert.equal(isDuplicate({ ...quake, point: { lon: 150, lat: 45 } }, gdacs, rule), false, 'far away');
    assert.equal(isDuplicate({ ...quake, startedAt: '2025-01-01T00:00:00.000Z' }, gdacs, { km: 100 }), true, 'no time limit (a volcano)');
    assert.equal(isDuplicate({ ...quake, point: undefined }, gdacs, rule), false);
    assert.equal(isDuplicate(quake, gdacs, undefined), false);
  });

  test('a markers-only source adds markers (marked as such) and never a level; an event GDACS has is shown once', () => {
    const index = placeIndex([{ id: 'ru', name: 'Russia', iso2: 'RU', iso3: 'RUS', shape: 'Russia' }, { id: 'cl', name: 'Chile', iso2: 'CL', iso3: 'CHL', shape: 'Chile' }]);
    const T = '2026-10-02T12:00:00.000Z';
    const gdacsConfig = { id: 'gdacs', staleAfterHours: 6, confirmFallMinutes: 0, scheme: 'gdacs-alert', levels: { Green: 1, Orange: 3, Red: 4 }, types: { EQ: { type: 'earthquake', category: 'disaster', tailDays: 7 } } };
    const gdacsQuake = { id: 'gdacs:EQ:1', code: 'EQ', name: 'Earthquake in Russia', iso3: ['RUS'], native: { scheme: 'gdacs-alert', value: 'Orange' }, point: { lon: 159.7, lat: 51.7 }, startedAt: '2026-10-01T10:00:00.000Z', toDate: '2026-10-01T10:00:00.000Z', current: false, firstSeen: T, revisions: [] };
    const [russia, , , , ] = parseQuakes(QUAKES);
    const twin = { ...russia, startedAt: '2026-10-01T10:20:00.000Z', toDate: '2026-10-01T10:20:00.000Z' };
    const other = { ...russia, id: 'usgs:other', point: { lon: -71, lat: -33 }, country: 'Chile', startedAt: '2026-10-01T00:00:00.000Z', toDate: '2026-10-01T00:00:00.000Z' };
    const input = {
      index, categories: { scale: { type: 'levels', values: [1, 2, 3, 4] }, categories: [{ id: 'disaster' }] }, schedule: { gdacs: { everyMinutes: 60 }, usgs: { everyMinutes: 60 } },
      advisories: { files: {}, history: {} },
      sources: {
        gdacs: { config: gdacsConfig, data: { fetchedAt: T, events: [gdacsQuake] } },
        usgs: { config: config('usgs'), data: { fetchedAt: T, events: [twin, other].map(({ magnitude, ...e }) => e) } },
      },
      state: null, log: [], sourcesState: { gdacs: { lastAttempt: T, lastSuccess: T }, usgs: { lastAttempt: T, lastSuccess: T } },
    };
    const r = buildRisk(input);
    const events = r.files['risk/events.json'].events;
    assert.deepEqual(events.map(e => [e.id, !!e.marker]).sort(), [['gdacs:EQ:1', false], ['usgs:other', true]], 'the USGS twin of GDACS\'s quake is left out');
    assert.deepEqual(events.find(e => e.id === 'usgs:other').placeIds, ['cl']);
    assert.equal(r.files['risk/current.json'].places.cl, undefined, 'a marker never sets a level');
    assert.deepEqual(Object.keys(r.files['risk/current.json'].categories), ['disaster']);
    assert.deepEqual(r.files['risk/current.json'].categories.disaster.sources, ['gdacs'], 'the level is GDACS\'s alone');
    assert.deepEqual(r.newChanges.filter(c => c.source === 'usgs'), []);
    assert.ok(r.files['risk/places/cl.json'].events.includes('usgs:other'), 'listed with the place\'s alerts');
    const down = buildRisk({ ...input, sourcesState: { ...input.sourcesState, usgs: { lastAttempt: T, lastSuccess: '2026-09-01T00:00:00.000Z', consecutiveFailures: 3 } } });
    assert.equal(down.files['risk/events.json'].events.some(e => e.id === 'usgs:other'), false, 'a source that is down shows no markers');
  });
});
