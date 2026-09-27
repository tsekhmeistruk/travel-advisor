import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { placeIndex } from '../../../scripts/lib/build.mjs';
import {
  healthStatus, travelSignals, eventLevel, isActive, eventPlaces, eventSignals, updateSignals, eventChanges,
  advisoryChanges, buildRisk, CHANGE_WINDOW_DAYS,
} from '../../../scripts/lib/risk.mjs';

const PLACES = [
  { id: 'mx', name: 'Mexico', iso2: 'MX', iso3: 'MEX', shape: 'Mexico' },
  { id: 'gt', name: 'Guatemala', iso2: 'GT', iso3: 'GTM', shape: 'Guatemala' },
  { id: 'jp', name: 'Japan', iso2: 'JP', iso3: 'JPN', shape: 'Japan' },
  { id: 'sb', name: 'Solomon Islands', iso2: 'SB', iso3: 'SLB', shape: 'Solomon Is.' },
  { id: 'gaza', name: 'Gaza', shape: 'Gaza' },
  { id: 'west-bank', name: 'West Bank', shape: 'West Bank' },
  { id: 'il', name: 'Israel', iso2: 'IL', iso3: 'ISR', shape: 'Israel' },
  { id: 'somaliland', name: 'Somaliland', shape: 'Somaliland' },
  { id: 'so', name: 'Somalia', iso2: 'SO', iso3: 'SOM', shape: 'Somalia' },
];
const index = placeIndex(PLACES);
const CONFIG = {
  id: 'gdacs', staleAfterHours: 6, confirmFallMinutes: 120, scheme: 'gdacs-alert',
  levels: { Green: 1, Orange: 3, Red: 4 },
  types: {
    EQ: { type: 'earthquake', category: 'disaster', tailDays: 7 },
    TC: { type: 'cyclone', category: 'disaster', tailDays: 3 },
    DR: { type: 'drought', category: 'disaster', tailDays: 0, maxLevel: 2 },
    WF: { type: 'wildfire', category: 'wildfire', tailDays: 3 },
  },
  codes: { PSE: ['gaza', 'west-bank'] },
};
const T0 = '2026-09-27T10:00:00.000Z';
const hoursAfter = (h, t = T0) => new Date(Date.parse(t) + h * 36e5).toISOString();
const ev = (id, code, value, extra = {}) => ({
  id: `gdacs:${code}:${id}`, code, name: `${code} ${id}`, native: { scheme: 'gdacs-alert', value }, iso3: ['MEX'],
  startedAt: '2026-09-25T00:00:00.000Z', toDate: '2026-09-27T09:00:00.000Z', current: true,
  firstSeen: T0, revisions: [{ at: T0, value }], ...extra,
});

describe('healthStatus', () => {
  const limits = { intervalMinutes: 60, staleAfterHours: 6 };
  const now = Date.parse(T0);
  test('healthy within 1.5 intervals, delayed after that or after a failure, error when stale or never fetched', () => {
    assert.equal(healthStatus({ lastSuccess: hoursAfter(-1), consecutiveFailures: 0 }, limits, now), 'healthy');
    assert.equal(healthStatus({ lastSuccess: hoursAfter(-2), consecutiveFailures: 0 }, limits, now), 'delayed');
    assert.equal(healthStatus({ lastSuccess: hoursAfter(-0.5), consecutiveFailures: 1 }, limits, now), 'delayed');
    assert.equal(healthStatus({ lastSuccess: hoursAfter(-7) }, limits, now), 'error');
    assert.equal(healthStatus({}, limits, now), 'error');
    assert.equal(healthStatus(undefined, limits, now), 'error');
  });
});

describe('travelSignals', () => {
  const file = (records) => ({ records });
  test('takes the highest government level per place, with every government\'s own level and the agreement', () => {
    const s = travelSignals({
      us: file([{ level: 4, places: ['so'], covers: ['somaliland'] }, { level: 2, places: ['mx'] }]),
      ca: file([{ level: 3, places: ['so'] }, { level: 2, places: ['mx'] }, { level: 3, places: ['somaliland'] }]),
    });
    assert.deepEqual(s.get('so'), { level: 4, natives: { us: 4, ca: 3 }, agree: 1 });
    assert.deepEqual(s.get('mx'), { level: 2, natives: { us: 2, ca: 2 }, agree: 2 });
    assert.deepEqual(s.get('somaliland'), { level: 4, natives: { us: 4, ca: 3 }, agree: 1 });
    assert.equal(s.get('jp'), undefined, 'no government covers it: no signal, not Normal');
  });
  test('a place\'s own advisory wins over one that covers it, and a shared one over a covering one', () => {
    const s = travelSignals({ ca: file([
      { level: 3, places: ['il', 'gaza', 'west-bank'] },
      { level: 4, places: ['gaza'] },
      { level: 2, places: ['so'], covers: ['somaliland'] },
      { level: 4, places: ['somaliland'] },
    ]) });
    assert.equal(s.get('gaza').level, 4);
    assert.equal(s.get('il').level, 3);
    assert.equal(s.get('somaliland').level, 4);
  });
});

describe('event levels, activity and places', () => {
  test('maps the native value through the config and caps it per type; unknown values are null', () => {
    assert.equal(eventLevel(ev(1, 'TC', 'Orange'), CONFIG), 3);
    assert.equal(eventLevel(ev(1, 'TC', 'Red'), CONFIG), 4);
    assert.equal(eventLevel(ev(1, 'DR', 'Red'), CONFIG), 2, 'drought caps at Elevated');
    assert.equal(eventLevel(ev(1, 'TC', 'Purple'), CONFIG), null);
  });
  test('an event counts while current, then for its type\'s tail', () => {
    const ended = (code, days) => ev(1, code, 'Orange', { current: false, toDate: hoursAfter(-24 * days) });
    assert.equal(isActive(ev(1, 'TC', 'Orange', { toDate: '2026-01-01T00:00:00.000Z' }), CONFIG, T0), true);
    assert.equal(isActive(ended('EQ', 6), CONFIG, T0), true);
    assert.equal(isActive(ended('EQ', 8), CONFIG, T0), false);
    assert.equal(isActive(ended('DR', 0.5), CONFIG, T0), false, 'no tail');
    assert.equal(isActive(ended('XX', 0), CONFIG, T0), true, 'an unknown type has no tail');
  });
  test('places by alpha-3 code, config codes for codes that are several places, country names as a fallback', () => {
    assert.deepEqual(eventPlaces(ev(1, 'TC', 'Orange', { iso3: ['GTM', 'MEX'] }), CONFIG, index), { placeIds: ['gt', 'mx'], unknownCodes: [] });
    assert.deepEqual(eventPlaces(ev(1, 'EQ', 'Orange', { iso3: ['PSE'] }), CONFIG, index).placeIds, ['gaza', 'west-bank']);
    assert.deepEqual(eventPlaces(ev(1, 'EQ', 'Orange', { iso3: ['XYZ', 'JPN'] }), CONFIG, index), { placeIds: ['jp'], unknownCodes: ['XYZ'] });
    assert.deepEqual(eventPlaces(ev(1, 'EQ', 'Orange', { iso3: [], country: 'Solomon Islands' }), CONFIG, index).placeIds, ['sb']);
    assert.deepEqual(eventPlaces(ev(1, 'EQ', 'Orange', { iso3: [], country: 'Off Coast Of Central Chile' }), CONFIG, index).placeIds, [], 'offshore');
    assert.deepEqual(eventPlaces(ev(1, 'EQ', 'Orange', { iso3: undefined, country: undefined }), CONFIG, index).placeIds, []);
  });
});

describe('eventSignals', () => {
  const data = (events) => ({ fetchedAt: T0, firstFetchedAt: T0, events });
  test('sets the highest active level per place and category, with the events that set it as basis', () => {
    const { byCategory, events, warnings } = eventSignals('gdacs', data([
      ev(1, 'TC', 'Orange'), ev(2, 'EQ', 'Orange'), ev(3, 'EQ', 'Red', { iso3: ['JPN'] }),
      ev(4, 'WF', 'Orange', { iso3: ['JPN'] }),
      ev(5, 'EQ', 'Red', { current: false, toDate: '2026-09-01T00:00:00.000Z', iso3: ['MEX'] }),
    ]), CONFIG, index);
    assert.deepEqual(byCategory.get('disaster').get('mx'), { level: 3, basis: ['gdacs:EQ:2', 'gdacs:TC:1'] });
    assert.deepEqual(byCategory.get('disaster').get('jp'), { level: 4, basis: ['gdacs:EQ:3'] });
    assert.deepEqual(byCategory.get('wildfire').get('jp'), { level: 3, basis: ['gdacs:WF:4'] });
    assert.equal(events.length, 4, 'inactive events are not published');
    assert.deepEqual(events[0], {
      id: 'gdacs:TC:1', source: 'gdacs', type: 'cyclone', category: 'disaster', level: 3, native: { scheme: 'gdacs-alert', value: 'Orange' },
      name: 'TC 1', country: undefined, severity: undefined, placeIds: ['mx'], point: undefined,
      startedAt: '2026-09-25T00:00:00.000Z', toDate: '2026-09-27T09:00:00.000Z', current: true, url: undefined,
    });
    assert.deepEqual(warnings, []);
  });
  test('warns about unknown types, values and codes, and keeps unknown-level events off the signals', () => {
    const { byCategory, events, warnings } = eventSignals('gdacs', data([
      ev(1, 'XX', 'Orange'), ev(2, 'TC', 'Purple'), ev(3, 'TC', 'Orange', { iso3: ['ZZZ'] }),
    ]), CONFIG, index);
    assert.equal(byCategory.get('disaster').size, 0);
    assert.equal(events.length, 2);
    assert.equal(events[0].level, null);
    assert.equal(warnings.length, 3);
    assert.match(warnings.join('\n'), /unknown event type "XX"/);
    assert.match(warnings.join('\n'), /unknown gdacs-alert value "Purple"/);
    assert.match(warnings.join('\n'), /unknown country codes ZZZ/);
  });
});

describe('updateSignals', () => {
  const opts = (at) => ({ category: 'disaster', at, confirmFallMinutes: 120, sources: ['gdacs'] });
  const levels = (entries) => new Map(entries.map(([id, level, basis = [`e-${id}`]]) => [id, { level, basis }]));

  test('the first run sets a baseline without changes', () => {
    const { state, changes } = updateSignals(undefined, levels([['mx', 3]]), opts(T0));
    assert.deepEqual(changes, []);
    assert.deepEqual(state, { trackedSince: T0, at: T0, places: { mx: { level: 3, basis: ['e-mx'] } } });
  });

  test('a rise is recorded at once, from Normal for a place that had no signal', () => {
    const base = updateSignals(undefined, levels([]), opts(T0)).state;
    const t1 = hoursAfter(1);
    const { state, changes } = updateSignals(base, levels([['mx', 3]]), opts(t1));
    assert.deepEqual(changes, [{ id: `mx:disaster:${t1}`, at: t1, kind: 'level', category: 'disaster', placeId: 'mx', from: 1, to: 3, up: true, basis: ['e-mx'], sources: ['gdacs'] }]);
    assert.deepEqual(state.places.mx, { level: 3, since: t1, from: 1, basis: ['e-mx'] });
    assert.equal(state.trackedSince, T0);
  });

  test('a fall waits until a fetch at least confirmFallMinutes later still shows it', () => {
    let state = updateSignals(undefined, levels([['mx', 3]]), opts(T0)).state;
    const t1 = hoursAfter(1);
    let r = updateSignals(state, levels([]), opts(t1));
    assert.deepEqual(r.changes, []);
    assert.deepEqual(r.state.places.mx.pending, { level: 1, firstSeen: t1 });
    assert.equal(r.state.places.mx.level, 3, 'the confirmed level stays');
    state = r.state;

    r = updateSignals(state, levels([]), opts(hoursAfter(2)));
    assert.deepEqual(r.changes, [], 'only 60 minutes later');
    r = updateSignals(r.state, levels([]), opts(hoursAfter(3)));
    assert.equal(r.changes.length, 1);
    assert.deepEqual([r.changes[0].from, r.changes[0].to, r.changes[0].up], [3, 1, false]);
    assert.equal(r.state.places.mx, undefined, 'back to Normal: no entry');
  });

  test('a fall to a level above Normal keeps the place, and a level that comes back cancels the pending fall', () => {
    let state = updateSignals(undefined, levels([['mx', 4]]), opts(T0)).state;
    state = updateSignals(state, levels([['mx', 3]]), opts(hoursAfter(1))).state;
    const back = updateSignals(state, levels([['mx', 4]]), opts(hoursAfter(2)));
    assert.deepEqual(back.changes, []);
    assert.equal(back.state.places.mx.pending, undefined);
    const fell = updateSignals(state, levels([['mx', 3]]), opts(hoursAfter(4)));
    assert.deepEqual(fell.state.places.mx, { level: 3, since: hoursAfter(4), from: 4, basis: ['e-mx'] });
    const other = updateSignals(state, levels([['mx', 2]]), opts(hoursAfter(4)));
    assert.deepEqual(other.state.places.mx.pending, { level: 2, firstSeen: hoursAfter(4) }, 'a different lower level starts a new wait');
  });

  test('running again on the same data changes nothing', () => {
    const base = updateSignals(undefined, levels([]), opts(T0)).state;
    const t1 = hoursAfter(1);
    const first = updateSignals(base, levels([['mx', 3], ['jp', 4]]), opts(t1));
    const again = updateSignals(first.state, levels([['mx', 3], ['jp', 4]]), opts(t1));
    assert.deepEqual(again.changes, []);
    assert.deepEqual(again.state, first.state);
    const pending = updateSignals(first.state, levels([['jp', 4]]), opts(hoursAfter(2)));
    const pendingAgain = updateSignals(pending.state, levels([['jp', 4]]), opts(hoursAfter(2)));
    assert.deepEqual(pendingAgain.state, pending.state);
  });
});

describe('eventChanges', () => {
  const data = (events, firstFetchedAt = '2026-09-01T00:00:00.000Z') => ({ fetchedAt: T0, firstFetchedAt, events });
  test('lists a new major event, but not those of the source\'s first fetch', () => {
    const changes = eventChanges('gdacs', data([ev(1, 'TC', 'Orange'), ev(2, 'EQ', 'Green')]), CONFIG, index);
    assert.deepEqual(changes, [{
      id: `gdacs:TC:1:${T0}`, at: T0, kind: 'event', category: 'disaster', source: 'gdacs', eventId: 'gdacs:TC:1', type: 'cyclone',
      placeIds: ['mx'], to: 3, native: 'Orange', new: true,
    }]);
    assert.deepEqual(eventChanges('gdacs', data([ev(1, 'TC', 'Orange')], T0), CONFIG, index), []);
  });
  test('lists alert changes where either side is major; ignores minor ones and capped types', () => {
    const t1 = hoursAfter(1);
    const tc = ev(1, 'TC', 'Red', { firstSeen: '2026-09-01T00:00:00.000Z', revisions: [{ at: '2026-09-01T00:00:00.000Z', value: 'Green' }, { at: T0, value: 'Orange' }, { at: t1, value: 'Red' }] });
    const dr = ev(2, 'DR', 'Red', { firstSeen: '2026-09-01T00:00:00.000Z', revisions: [{ at: '2026-09-01T00:00:00.000Z', value: 'Orange' }, { at: T0, value: 'Red' }] });
    const changes = eventChanges('gdacs', data([tc, dr, ev(3, 'XX', 'Red')]), CONFIG, index);
    assert.deepEqual(changes.map(c => [c.id, c.from, c.to, c.up]), [[`gdacs:TC:1:${T0}`, 1, 3, true], [`gdacs:TC:1:${t1}`, 3, 4, true]]);
  });
});

describe('advisoryChanges', () => {
  test('lists every level change in the history on the record\'s places, marking seeded ones', () => {
    const history = { us: {
      Chad: [{ date: '2026-04-28', level: 4, from: null, up: true, source: 'note' }, { date: '2026-09-26', level: 4 }],
      Mexico: [{ date: '2026-09-26', level: 2 }, { date: '2026-09-28', level: 3 }],
      Gone: [{ date: '2026-09-26', level: 1 }, { date: '2026-09-27', level: 2 }],
    } };
    const files = { us: { records: [{ title: 'Chad', places: ['td'] }, { title: 'Mexico', places: ['mx'] }] } };
    assert.deepEqual(advisoryChanges(history, files), [
      { id: 'advisory:us:Chad:2026-04-28', at: '2026-04-28', kind: 'advisory', category: 'travel', source: 'us', title: 'Chad', placeIds: ['td'], from: null, to: 4, up: true, seeded: true },
      { id: 'advisory:us:Mexico:2026-09-28', at: '2026-09-28', kind: 'advisory', category: 'travel', source: 'us', title: 'Mexico', placeIds: ['mx'], from: 2, to: 3, up: true },
    ]);
  });
});

describe('buildRisk', () => {
  const CATEGORIES = { scale: { type: 'levels', values: [1, 2, 3, 4] }, categories: [{ id: 'travel' }, { id: 'disaster' }, { id: 'wildfire' }] };
  const SCHEDULE = { us: { every: 'daily-slot' }, gdacs: { everyMinutes: 60 } };
  const advisories = {
    files: { us: { asOf: '2026-09-27', records: [{ title: 'Mexico', level: 2, places: ['mx'] }] } },
    history: { us: { Mexico: [{ date: '2026-09-20', level: 1 }, { date: '2026-09-26', level: 2 }] } },
  };
  const input = (over = {}) => ({
    index, categories: CATEGORIES, schedule: SCHEDULE, advisories,
    sources: { gdacs: { config: CONFIG, data: { fetchedAt: T0, firstFetchedAt: '2026-09-01T00:00:00.000Z', events: [ev(1, 'TC', 'Orange'), ev(2, 'EQ', 'Orange', { iso3: [], country: 'Off Coast Of Chile' })] } } },
    state: { categories: { disaster: { trackedSince: '2026-09-01T00:00:00.000Z', at: '2026-09-01T00:00:00.000Z', places: {} }, wildfire: { trackedSince: '2026-09-01T00:00:00.000Z', at: '2026-09-01T00:00:00.000Z', places: {} } } },
    log: [],
    sourcesState: { us: { lastAttempt: '2026-09-27T05:00:00.000Z', lastSuccess: '2026-09-27T05:00:00.000Z', consecutiveFailures: 0 }, gdacs: { lastAttempt: T0, lastSuccess: T0, consecutiveFailures: 0 } },
    ...over,
  });

  test('publishes signals of every category, changes, active events and health', () => {
    const { files, newChanges, warnings } = buildRisk(input());
    const current = files['risk/current.json'];
    assert.equal(current.asOf, T0, 'the newest fetch time, not the clock');
    assert.deepEqual(current.categories, {
      travel: { sources: ['us'], default: null },
      disaster: { sources: ['gdacs'], default: 1, status: 'healthy', at: T0 },
      wildfire: { sources: ['gdacs'], default: 1, status: 'healthy', at: T0 },
    });
    assert.deepEqual(current.places.mx, {
      travel: { level: 2, natives: { us: 2 }, agree: 1 },
      disaster: { level: 3, since: T0, from: 1, basis: ['gdacs:TC:1'] },
    });
    assert.deepEqual(newChanges.map(c => c.id), [`gdacs:TC:1:${T0}`, `gdacs:EQ:2:${T0}`, `mx:disaster:${T0}`].sort());
    const kinds = files['risk/changes.json'].changes.map(c => c.kind);
    assert.deepEqual(kinds.sort(), ['advisory', 'event', 'event', 'level']);
    assert.equal(files['risk/events.json'].events.length, 2);
    assert.match(warnings.join('\n'), /gdacs:EQ:2 .* is on no place; shown as a marker only/);
    assert.deepEqual(Object.keys(files['risk/health.json'].sources), ['gdacs', 'us']);
    assert.equal(files['risk/health.json'].sources.us.status, 'healthy');
  });

  test('building again with its own output adds nothing', () => {
    const first = buildRisk(input());
    const again = buildRisk(input({ state: first.state, log: first.newChanges }));
    assert.deepEqual(again.newChanges, []);
    assert.deepEqual(again.state, first.state);
    assert.deepEqual(again.files, first.files);
  });

  test('a source past its stale limit shows "no data" and keeps its last state instead of turning places Normal', () => {
    const state = { categories: { disaster: { trackedSince: T0, at: T0, places: { jp: { level: 4, basis: ['x'] } } } } };
    const late = hoursAfter(10);
    const { files, newChanges } = buildRisk(input({
      state,
      sourcesState: { us: { lastAttempt: late, lastSuccess: late }, gdacs: { lastAttempt: late, lastSuccess: T0, consecutiveFailures: 10 } },
    }));
    const current = files['risk/current.json'];
    assert.equal(current.categories.disaster.default, null);
    assert.equal(current.categories.disaster.status, 'error');
    assert.equal(current.places.jp, undefined, 'unavailable categories publish no levels');
    assert.deepEqual(newChanges, []);
    assert.deepEqual(buildRisk(input({ state, sources: { gdacs: { config: CONFIG, data: null } } })).state, state);
  });

  test('publishes only the changes of the last CHANGE_WINDOW_DAYS days, newest first, and warns about unknown categories', () => {
    const old = { id: 'old', at: '2026-05-01T00:00:00.000Z', kind: 'level', category: 'disaster' };
    const recent = { id: 'recent', at: '2026-09-20T00:00:00.000Z', kind: 'level', category: 'disaster' };
    const cfg = { ...CONFIG, types: { ...CONFIG.types, XX: { type: 'x', category: 'unknown', tailDays: 0 } } };
    const { files, warnings } = buildRisk(input({ log: [old, recent], sources: { gdacs: { config: cfg, data: { fetchedAt: T0, firstFetchedAt: T0, events: [] } } } }));
    const changes = files['risk/changes.json'];
    assert.equal(changes.windowDays, CHANGE_WINDOW_DAYS);
    assert.deepEqual(changes.changes.map(c => c.id), ['advisory:us:Mexico:2026-09-26', 'recent']);
    assert.match(warnings.join('\n'), /category "unknown" is not in config\/categories\.json/);
  });

  test('works with nothing fetched yet', () => {
    const { files } = buildRisk(input({ sources: {}, sourcesState: {}, advisories: { files: {}, history: {} } }));
    assert.equal(files['risk/current.json'].asOf, null);
    assert.deepEqual(files['risk/changes.json'].changes, []);
    assert.equal(files['risk/health.json'].sources.gdacs.status, 'error');
  });
});
