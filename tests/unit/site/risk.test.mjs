// The risk modes (views and rules) with small fake risk files, real English messages, a fixed
// clock and in-memory settings. No browser needed.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRiskMode, WINDOWS } from '../../../site/js/datasets/risk/index.js';
import {
  changeTime, ageHours, changePlaces, direction, levelOf, highest, filterChanges, changesFor, pulseOpacity, countByLevel,
  countDirections, cardModel, isStale, countryRows, sortRows, isNews, levelIn, groupFeed,
} from '../../../site/js/datasets/risk/logic.js';
import { MODES, DEFAULT_MODE, RENAMED } from '../../../site/js/datasets/registry.js';
import { clusterMarkers, MARKER_ICONS } from '../../../site/js/map/clusters.js';
import { createI18n } from '../../../site/js/core/i18n.js';
import { createSettings } from '../../../site/js/core/settings.js';
import { parseHash, formatHash, startState } from '../../../site/js/core/url-state.js';

const EN = JSON.parse(readFileSync(new URL('../../../site/i18n/en.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-09-27T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 36e5).toISOString();
const PLACES = new Map([
  ['mx', { id: 'mx', name: 'Mexico', iso2: 'MX' }],
  ['jp', { id: 'jp', name: 'Japan', iso2: 'JP' }],
  ['so', { id: 'so', name: 'Somalia', iso2: 'SO' }],
  ['ke', { id: 'ke', name: 'Kenya', iso2: 'KE' }],
  ['aq', { id: 'aq', name: 'Antarctica', iso2: 'AQ' }],
]);
const CURRENT = {
  asOf: hoursAgo(2),
  categories: {
    travel: { sources: ['us', 'ca'], default: null },
    conflict: { sources: ['ucdp'], default: 1, status: 'healthy', at: hoursAgo(2) },
    disaster: { sources: ['gdacs'], default: 1, status: 'healthy', at: hoursAgo(2) },
    wildfire: { sources: ['gdacs'], default: 1, status: 'healthy', at: hoursAgo(2) },
  },
  sources: { gdacs: { url: 'https://www.gdacs.org/' }, us: { url: 'javascript:alert(1)', flag: 'us' }, ca: { flag: 'ca' }, uk: { flag: 'gb' } },
  places: {
    mx: { travel: { level: 2, natives: { us: 2, ca: 2 }, agree: 2 }, disaster: { level: 3, since: hoursAgo(5), from: 1, basis: ['gdacs:TC:1', 'gdacs:EQ:2'] } },
    jp: { travel: { level: 1, natives: { us: 1, ca: 1 }, agree: 2 } },
    so: { travel: { level: 4, natives: { us: 4, ca: 3 }, agree: 1 }, conflict: { level: 4, basis: ['ucdp:2026-08'] }, disaster: { level: 2, basis: ['gdacs:DR:3'] } },
    // A stricter government than the travel level (two or more must agree): named on the card.
    ke: { travel: { level: 2, natives: { us: 3, ca: 2 }, agree: 1, strictest: { level: 3, by: ['us'] } }, disaster: { level: 2, basis: ['gdacs:DR:3'] } },
  },
};
const CHANGES = [
  { id: `mx:disaster:${hoursAgo(5)}`, at: hoursAgo(5), kind: 'level', category: 'disaster', placeId: 'mx', from: 1, to: 3, up: true, basis: ['gdacs:TC:1'] },
  { id: `gdacs:TC:1:${hoursAgo(5)}`, at: hoursAgo(5), kind: 'event', category: 'disaster', source: 'gdacs', eventId: 'gdacs:TC:1', type: 'cyclone', placeIds: ['mx'], to: 3, native: 'Orange', new: true },
  { id: `gdacs:EQ:9:${hoursAgo(30)}`, at: hoursAgo(30), kind: 'event', category: 'disaster', source: 'gdacs', eventId: 'gdacs:EQ:9', type: 'earthquake', placeIds: [], from: 4, to: 3, up: false, native: 'Orange' },
  { id: 'advisory:us:Somalia:2026-09-20', at: '2026-09-20', kind: 'advisory', category: 'travel', source: 'us', title: 'Somalia', placeIds: ['so'], from: 3, to: 4, up: true },
  { id: 'advisory:us:Kenya:2026-09-01', at: '2026-09-01', kind: 'advisory', category: 'travel', source: 'us', title: 'Kenya', placeIds: ['ke'], from: 3, to: 2, up: false },
  { id: 'advisory:us:Japan:2026-07-01', at: '2026-07-01', kind: 'advisory', category: 'travel', source: 'us', title: 'Japan', placeIds: ['jp'], from: null, to: 1, up: false, seeded: true },
];
const DATES = { startedAt: '2026-09-21T03:00:00.000Z', toDate: '2026-09-27T09:00:00.000Z', current: true };
const EVENTS = [
  { id: 'gdacs:TC:1', source: 'gdacs', ...DATES, category: 'disaster', type: 'cyclone', level: 3, native: { scheme: 'gdacs-alert', value: 'Orange' }, name: 'Tropical Cyclone <b>X</b>', placeIds: ['mx'], url: 'https://www.gdacs.org/report.aspx?eventid=1' },
  { id: 'gdacs:EQ:2', source: 'gdacs', ...DATES, category: 'disaster', type: 'earthquake', level: 3, native: { scheme: 'gdacs-alert', value: 'Orange' }, name: 'EQ', placeIds: ['mx'], url: 'javascript:alert(1)' },
  { id: 'gdacs:EQ:9', source: 'gdacs', ...DATES, category: 'disaster', type: 'earthquake', level: 3, native: { scheme: 'gdacs-alert', value: 'Orange' }, name: 'Offshore quake', placeIds: [] },
  { id: 'gdacs:DR:3', source: 'gdacs', ...DATES, category: 'disaster', type: 'drought', level: 2, native: { scheme: 'gdacs-alert', value: 'Orange' }, name: 'Drought', placeIds: ['so', 'ke'] },
];
const MANIFEST = { asOf: CURRENT.asOf, current: 'risk/current.json', changes: 'risk/changes.json', events: 'risk/events.json', conflict: 'risk/conflict.json', places: 'risk/places/' };
// The conflict figures (risk/conflict.json), as lib/conflict.mjs publishes them; only what the risk card reads.
const CONFLICT = { source: 'ucdp', through: '2026-08', links: { home: 'https://ucdp.uu.se/', conflict: 'https://ucdp.uu.se/conflict/' }, places: { so: { deaths12: 3304 }, ke: { deaths12: 1 } } };
// A place file's conflict section: a conflict fought there (with its sides), and a war it is a
// party to elsewhere (as an older place file had it, without sides: named by UCDP's name).
const KENYA_WAR = { key: '1:9', name: null, deaths12: 3304, last: 200, war: true, places: ['so'], parties: ['ke'] };
const KENYA_GOV = { key: '1:5', name: 'Kenya: Government', deaths12: 20, last: 20, war: false, places: ['ke'], parties: ['ke'],
  sides: { a: [{ name: 'Government of Kenya', place: 'ke', deaths: 20 }], b: [{ name: 'Al-Shabaab', deaths: 15 }, { name: 'IS', deaths: 3 }, { name: null, deaths: 2 }, { name: 'ASWJ', deaths: 1 }] } };
const KE_FILE = {
  placeId: 'ke', advisories: {}, events: [], changes: [],
  conflict: {
    through: '2026-08', deaths12: 30, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30], byType: { state: 20, nonState: 5, oneSided: 5 }, trend: null,
    conflicts: [KENYA_GOV],
    partyTo: [KENYA_GOV, KENYA_WAR],
  },
};
// A place file as the build writes it: advisories, active event ids, a year of changes.
const MX_FILE = {
  placeId: 'mx',
  advisories: {
    us: { level: 2, title: 'Mexico', updated: '2026-05-29', url: 'https://travel.state.gov/mx', own: true },
    uk: { level: 2, title: 'Mexico', updated: '2026-09-26', url: 'https://www.gov.uk/foreign-travel-advice/mexico', own: true },
    ca: { level: 3, title: 'North <America>', updated: '2026-09-26', url: 'javascript:alert(1)', own: false },
  },
  events: ['gdacs:TC:1', 'gdacs:EQ:2'],
  changes: [CHANGES[0], CHANGES[1], { id: 'mx:travel:old', at: '2026-01-10', kind: 'advisory', category: 'travel', source: 'us', placeIds: ['mx'], from: 1, to: 2, up: true }],
};

let ds, changes, requested, storage;
async function create({ view = 'highest', category, mode = view === 'category' ? category : view, saved = {}, current = CURRENT, events = EVENTS } = {}) {
  storage = new Map(Object.entries({ 'travel-risk-map:settings': JSON.stringify({ risk: saved }) }));
  const settings = createSettings('travel-risk-map:settings', {}, { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) });
  requested = [];
  const files = { 'risk/current.json': current, 'risk/changes.json': { changes: CHANGES }, 'risk/events.json': { events }, 'risk/conflict.json': CONFLICT, 'risk/places/mx.json': MX_FILE, 'risk/places/ke.json': KE_FILE };
  const client = { file: async (path, version) => { requested.push([path, version]); if (!files[path]) throw new Error('HTTP 404'); return files[path]; } };
  changes = 0;
  ds = createRiskMode({
    i18n: createI18n({ locale: 'en', messages: EN, today: new Date(NOW) }), settings, client, manifest: MANIFEST, places: PLACES,
    changed: () => changes++, mode, view, category, now: () => NOW,
  });
  await ds.load();
  return ds;
}
beforeEach(() => create());

// A stand-in for the Latest changes block: its list, title, count and window switch.
function fakeFeed() {
  const title = { textContent: '' }, count = { textContent: '' }, tools = { innerHTML: '' };
  const section = { hidden: true, querySelector: (sel) => ({ '#recentTitle': title, '#recentCount': count, '#recentTools': tools })[sel] };
  return { el: { innerHTML: '', closest: () => section }, section, title, count, tools };
}
const clickOn = (container, attrs) => container.onclick({ target: { closest: (sel) => {
  const key = { '.chip': 'level', '[data-days]': 'days', '[data-dir]': 'dir' }[sel];
  return key && attrs[key] != null ? { dataset: { [key]: String(attrs[key]) } } : null;
} } });

describe('logic', () => {
  test('dates changes by UTC day or by time, and measures their age in hours', () => {
    assert.equal(changeTime('2026-09-27'), Date.parse('2026-09-27T00:00:00Z'));
    assert.equal(ageHours('2026-09-27', NOW), 12);
    assert.equal(ageHours(hoursAgo(5), NOW), 5);
    assert.equal(ageHours(new Date(NOW + 36e5).toISOString(), NOW), 0, 'never negative');
  });
  test('knows a change\'s places and direction; a new event counts as a rise', () => {
    assert.deepEqual(changePlaces(CHANGES[0]), ['mx']);
    assert.deepEqual(changePlaces(CHANGES[3]), ['so']);
    assert.deepEqual(changePlaces({}), []);
    assert.deepEqual(CHANGES.map(direction), ['up', 'up', 'down', 'up', 'down', 'down']);
  });
  test('a level is the signal, else the category default; no data is null', () => {
    assert.equal(levelOf(CURRENT, 'mx', 'disaster'), 3);
    assert.equal(levelOf(CURRENT, 'jp', 'disaster'), 1, 'covered, nothing active: Normal');
    assert.equal(levelOf(CURRENT, 'aq', 'travel'), null, 'no government covers it');
    assert.equal(levelOf(CURRENT, 'mx', 'security'), null, 'not a published category');
  });
  test('the highest level names the categories that set it, but none for Normal', () => {
    assert.deepEqual(highest(CURRENT, 'mx'), { level: 3, by: ['disaster'] });
    assert.deepEqual(highest(CURRENT, 'ke'), { level: 2, by: ['travel', 'disaster'] });
    assert.deepEqual(highest(CURRENT, 'jp'), { level: 1, by: [] });
    assert.deepEqual(highest({ categories: { travel: { default: null } }, places: {} }, 'aq'), { level: null, by: [] });
  });
  test('filters changes by window, direction, category and kind', () => {
    const ids = (list) => list.map(c => c.id.split(':')[0] + ':' + c.id.split(':')[1]);
    assert.equal(filterChanges(CHANGES, { windowDays: 1, now: NOW }).length, 2);
    assert.equal(filterChanges(CHANGES, { windowDays: 90, now: NOW }).length, 6);
    assert.deepEqual(ids(filterChanges(CHANGES, { windowDays: 30, direction: 'down', now: NOW })), ['gdacs:EQ', 'advisory:us']);
    assert.equal(filterChanges(CHANGES, { windowDays: 30, categories: new Set(['travel']), now: NOW }).length, 2);
    assert.ok(filterChanges(CHANGES, { windowDays: 90, pulseOnly: true, now: NOW }).every(c => c.kind !== 'event'));
    assert.deepEqual(changesFor('mx', CHANGES).length, 2);
  });
  test('fresher changes pulse brighter; counts levels and directions', () => {
    assert.ok(pulseOpacity(CHANGES[0], 30, NOW) > pulseOpacity(CHANGES[3], 30, NOW));
    assert.equal(pulseOpacity({ at: '2020-01-01' }, 30, NOW), 0.45);
    assert.deepEqual(countByLevel(['mx', 'jp', 'so', 'aq'], id => highest(CURRENT, id).level), [2, 0, 1, 1], 'aq: Normal (disaster covers it)');
    assert.deepEqual(countByLevel(['mx'], () => null), [0, 0, 0, 0]);
    assert.deepEqual(countDirections(CHANGES), { up: 2, down: 2 }, 'events are not counted');
  });
  test('the card model lists every category with its basis, the 24-hour trend and the place\'s history', () => {
    const m = cardModel('mx', { current: CURRENT, changes: CHANGES, events: EVENTS, now: NOW, windowDays: 30 });
    assert.deepEqual(m.highest, { level: 3, by: ['disaster'] });
    assert.deepEqual(m.rows.map(r => [r.category, r.level, r.changed]), [['travel', 2, null], ['conflict', 1, null], ['disaster', 3, 'up']], 'wildfire is in the disaster row');
    assert.deepEqual(m.rows[0].basis, { travel: { agree: 2, count: 2 } });
    assert.deepEqual(m.rows[1].basis, null, 'no conflict figures given: no basis');
    assert.deepEqual(m.rows[2].basis.events.map(e => e.id), ['gdacs:TC:1', 'gdacs:EQ:2']);
    assert.deepEqual(m.rows[2].members, ['disaster', 'wildfire']);
    const so = cardModel('so', { current: CURRENT, changes: CHANGES, events: EVENTS, conflict: CONFLICT, now: NOW, windowDays: 30 });
    assert.deepEqual(so.rows[1], { category: 'conflict', members: ['conflict'], level: 4, basis: { conflict: { deaths12: 3304 } }, changed: null, falling: null });
    assert.deepEqual(cardModel('jp', { current: CURRENT, changes: CHANGES, events: EVENTS, conflict: CONFLICT, now: NOW, windowDays: 30 }).rows[1].basis, { conflict: { deaths12: 0 } }, 'Normal: none recorded');
    assert.equal(m.trend, 'up');
    assert.equal(m.history.length, 2);
    assert.equal(m.link, 'https://www.gdacs.org/report.aspx?eventid=1');
    const aq = cardModel('aq', { current: CURRENT, changes: CHANGES, events: EVENTS, now: NOW, windowDays: 30 });
    assert.deepEqual([aq.rows[0].basis, aq.trend, aq.link, aq.history], [null, null, null, []]);
  });
  test('the card history leaves news activity out: it is not a change', () => {
    const news = { id: 'mx:protest', at: hoursAgo(1), kind: 'anomaly', placeId: 'mx', series: 'protest', from: 'normal', to: 'far', up: true };
    assert.equal(isNews(news), true);
    assert.equal(isNews(CHANGES[0]), false);
    const m = cardModel('mx', { current: CURRENT, changes: [news, ...CHANGES], events: EVENTS, now: NOW, windowDays: 30 });
    assert.deepEqual(m.history.map(c => c.id), [CHANGES[0].id, CHANGES[1].id]);
  });
});

describe('url state', () => {
  test('reads and writes the mode and the selected place', () => {
    assert.deepEqual(parseHash('#mode=disaster&place=mx'), { mode: 'disaster', place: 'mx', view: null, war: null });
    assert.deepEqual(parseHash(''), { mode: null, place: null, view: null, war: null });
    assert.deepEqual(parseHash(undefined), { mode: null, place: null, view: null, war: null });
    assert.equal(formatHash({ mode: 'travel' }), '#mode=travel');
    assert.equal(formatHash({ mode: 'disaster', place: 'mx' }), '#mode=disaster&place=mx');
    assert.equal(formatHash({}), '');
    // A refresh starts at home: the mode stays, the selection and the list don't. A link opens as written.
    const link = parseHash('#mode=wars&war=1-309&view=list');
    assert.deepEqual(startState(link, 'navigate'), link);
    assert.deepEqual(startState(link, undefined), link);
    assert.deepEqual(startState(link, 'back_forward'), link);
    assert.deepEqual(startState(link, 'reload'), { mode: 'wars', place: null, view: null, war: null });
    assert.deepEqual(startState(parseHash('#mode=travel&place=mx'), 'reload'), { mode: 'travel', place: null, view: null, war: null });
    assert.deepEqual(parseHash('#mode=highest&place=mx&view=country'), { mode: 'highest', place: 'mx', view: 'country', war: null });
    assert.equal(formatHash({ mode: 'highest', place: 'mx', view: 'country' }), '#mode=highest&place=mx&view=country');
    assert.equal(formatHash({ mode: 'highest', view: 'country' }), '#mode=highest', 'a country view needs a place');
    assert.equal(formatHash({ mode: 'highest', view: 'list' }), '#mode=highest&view=list', 'the list does not');
    assert.deepEqual(parseHash('#mode=highest&view=list'), { mode: 'highest', place: null, view: 'list', war: null });
  });
  test('a war: a UCDP conflict key, written with a dash; a place wins over it', () => {
    assert.equal(formatHash({ mode: 'wars', war: '1:309' }), '#mode=wars&war=1-309');
    assert.equal(parseHash('#mode=wars&war=1-309').war, '1:309');
    assert.equal(parseHash('#mode=wars&war=1:309').war, '1:309', 'the colon too');
    assert.equal(parseHash('#mode=wars&war=sudan').war, null, 'not a key');
    assert.equal(formatHash({ mode: 'wars', place: 'sd', war: '1:309' }), '#mode=wars&place=sd');
  });
});

describe('modes registry', () => {
  test('offers travel always, and the risk modes only when the manifest has risk data', () => {
    const withRisk = { datasets: [{ id: 'travel-advisories' }], risk: MANIFEST };
    assert.deepEqual(MODES.filter(m => m.entry(withRisk)).map(m => m.id), ['wars', 'disaster', 'travel', 'highest'], 'Wars, Disasters, Travel, All');
    const { conflict, ...noConflict } = MANIFEST;
    assert.deepEqual(MODES.filter(m => m.entry({ datasets: [], risk: noConflict })).map(m => m.id), ['disaster', 'highest'], 'Wars needs the conflict figures');
    assert.deepEqual(RENAMED, { wildfire: 'disaster', changes: 'wars' }, 'old links and saved modes go to their successor');
    assert.equal(EN.modes.highest.label, 'All');
    assert.equal(DEFAULT_MODE, 'wars');
    assert.deepEqual(MODES.filter(m => m.entry({ datasets: [{ id: 'travel-advisories' }] })).map(m => m.id), ['travel']);
    for (const m of MODES) assert.ok(EN.modes[m.id]?.label && EN.modes[m.id]?.title, `${m.id}: label and title`);
  });
});

describe('loading', () => {
  test('loads the risk files (and the conflict figures, when published), versioned by their as-of time, and has no providers', async () => {
    assert.deepEqual(requested, [['risk/current.json', CURRENT.asOf], ['risk/changes.json', CURRENT.asOf], ['risk/events.json', CURRENT.asOf], ['risk/conflict.json', CURRENT.asOf]]);
    assert.deepEqual(ds.providers(), []);
    assert.equal(ds.provider(), null);
    assert.equal(ds.providerSwitchLabel(), '');
    assert.equal(ds.id, 'highest');
  });
  test('without published conflict figures, the conflict row has no basis', async () => {
    const { conflict, ...withoutConflict } = MANIFEST;
    const settings = createSettings('k', {}, { getItem: () => null, setItem() {} });
    const files = { 'risk/current.json': CURRENT, 'risk/changes.json': { changes: CHANGES }, 'risk/events.json': { events: EVENTS } };
    const asked = [];
    const mode = createRiskMode({ i18n: createI18n({ locale: 'en', messages: EN, today: new Date(NOW) }), settings, client: { file: async (p) => { asked.push(p); return files[p]; } },
      manifest: withoutConflict, places: PLACES, changed() {}, mode: 'highest', view: 'highest', now: () => NOW });
    await mode.load();
    assert.equal(asked.includes(conflict), false);
    assert.match(mode.details({ placeId: 'so' }), /Conflict<\/span>\s*<span class="lvl">Critical<\/span>\s*<span class="basis" title="">/);
  });
});

describe('map style', () => {
  test('highest: colours by the highest level, pulses only level changes, dots only above Normal', () => {
    assert.deepEqual(ds.style('mx'), { cls: 'l3', muted: false, dim: false, dot: true, pulse: ds.style('mx').pulse });
    assert.ok(ds.style('mx').pulse > 0);
    assert.ok(ds.style('so').pulse > 0, 'an advisory level change pulses');
    assert.equal(ds.style('jp').pulse, null, 'too old for the 30-day window');
    assert.deepEqual(ds.style('jp'), { cls: 'r1', muted: false, dim: false, dot: false, pulse: null }, 'Normal: the calm risk fill, not advisory green');
    assert.deepEqual(ds.style('aq'), { cls: 'r1', muted: false, dim: false, dot: false, pulse: null }, 'disaster covers it: Normal');
    assert.match(ds.legend(), /background:var\(--risk-normal\)"><\/span>Normal/);
  });
  test('a category mode colours by that category only', async () => {
    await create({ view: 'category', category: 'disaster' });
    assert.equal(ds.style('so').cls, 'l2', 'travel level 4 is ignored');
    assert.equal(ds.style('so').pulse, null, 'the travel change does not pulse here');
    assert.ok(ds.style('mx').pulse > 0);
  });
  test('no data is drawn as no data, not Normal', async () => {
    await create({ view: 'category', category: 'disaster', current: { ...CURRENT, categories: { ...CURRENT.categories, disaster: { sources: ['gdacs'], default: null, status: 'error' } }, places: {} } });
    assert.deepEqual(ds.style('mx'), { cls: 'none', muted: false, dim: false, dot: false, pulse: null });
    assert.equal(ds.hasPlace('mx'), false);
  });
  test('hidden levels (switched in the legend) are muted and do not pulse; a saved fading or direction is ignored', async () => {
    await create({ saved: { levels: [1, 2, 4] } });
    assert.equal(ds.style('mx').muted, true);
    assert.equal(ds.style('mx').pulse, null);
    assert.match(ds.legend(), /<button class="legend-item legend-toggle" data-level="3" aria-pressed="false"/);
    ds.toggleLevel(3);
    assert.equal(changes, 1);
    assert.equal(ds.style('mx').muted, false);
    assert.match(ds.legend(), /data-level="3" aria-pressed="true"/);
    await create({ saved: { dimOthers: true, direction: 'down' } });
    assert.equal(ds.style('mx').dim, false, 'the Filters are gone: no fading');
    assert.notEqual(ds.style('mx').pulse, null, 'and its rise counts (no direction filter)');
  });
  test('falls back to defaults for invalid saved settings', async () => {
    await create({ saved: { recentDays: 5, levels: 'x', direction: 'sideways' } });
    const saved = JSON.parse(storage.get('travel-risk-map:settings')).risk;
    assert.deepEqual([saved.recentDays, saved.levels, saved.direction], [30, [1, 2, 3, 4], 'all']);
  });
});

describe('details card', () => {
  test('the overview counts places per level, in one block', () => {
    const html = ds.details(null);
    assert.match(html, /World overview · All/);
    assert.match(html, /3 places above Normal/);
    assert.match(html, /^<section class="card block">/, 'one "Now" block');
    assert.doesNotMatch(html, /raised|Latest changes|data-action="list"|Hover or tap/, 'the changes are the block below; no link or hint');
  });
  test('a place shows every category, what set its level, and its recent changes', () => {
    const html = ds.details({ placeId: 'mx' });
    assert.match(html, /<h3[^>]*>Mexico<\/h3>/);
    assert.match(html, /High · Disaster/);
    assert.match(html, /Raised in the last 24 hours/);
    assert.match(html, /Travel<\/span>\s*<span class="lvl">Elevated/);
    assert.match(html, /2 of 2 governments/);
    assert.match(html, /GDACS Orange alert: tropical cyclone \+1/);
    assert.match(html, /Conflict<\/span>\s*<span class="lvl">Normal<\/span>\s*<span class="basis" title="None recorded in 12 months \(UCDP\)">None recorded \(UCDP\)</);
    assert.doesNotMatch(html, /Wildfire<\/span>/, 'wildfires are in the disaster row');
    assert.match(ds.details({ placeId: 'so' }), /Conflict<\/span>\s*<span class="lvl">Critical<\/span>\s*<span class="basis" title="3,304 deaths in 12 months \(UCDP\)">3,304 deaths \(UCDP\)</, 'short on the row, in full in the title');
    assert.match(ds.details({ placeId: 'ke' }), /title="1 death in 12 months \(UCDP\)">1 death \(UCDP\)</);
    assert.match(html, /Disaster: Normal → High/);
    assert.match(html, /New GDACS Orange alert: tropical cyclone/);
    assert.match(html, /href="https:\/\/www\.gdacs\.org\/report\.aspx\?eventid=1"/);
    assert.match(html, /<p class="later"><\/p>/, 'no news source published: the slot stays, empty');
    assert.doesNotMatch(html, /coming later/);
    assert.doesNotMatch(html, /data-action="country"/, 'no Country details link: the panel shows the other blocks below');
  });
  test('a government stricter than the travel level is named on the row by its flag, in full in the title', () => {
    const html = ds.details({ placeId: 'ke' });
    assert.match(html, /Travel<\/span>\s*<span class="lvl">Elevated<\/span>[^<]*(<span class="arrow[^>]*>▼<\/span>)?\s*<span class="basis" title="1 of 2 governments give this level; U\.S\. gives High">1 of 2 · <img class="flag mini" src="assets\/flags\/us\.svg" alt="U\.S\."[^>]*> High<\/span>/);
    assert.match(ds.details({ placeId: 'mx' }), /title="2 of 2 governments">2 of 2 governments</, 'they agree: the plain count');
  });
  test('a place with no data says so, and without changes says that', () => {
    const html = ds.details({ placeId: 'aq' });
    assert.match(html, /No advisory/);
    assert.match(html, /No changes in the last 90 days\./);
    assert.doesNotMatch(html, /report ↗/);
  });
  test('a saved 24-hour window (no longer offered) becomes 30 days; an empty list is its heading and 0', async () => {
    await create({ saved: { recentDays: 1, levels: [1] } });
    assert.equal(JSON.parse(storage.get('travel-risk-map:settings')).risk.recentDays, 30);
    const f = fakeFeed();
    ds.renderFeed(f.el);
    assert.equal(f.el.innerHTML, '', 'an empty feed is its heading and 0');
    assert.equal(f.count.textContent, 0);
  });
  test('a marker-only event (a USGS quake): its magnitude alone, no level beside it; USGS\'s note; on the map and in the footer', async () => {
    const quake = { id: 'usgs:us1', source: 'usgs', ...DATES, category: 'disaster', type: 'earthquake', level: 1, marker: true, native: { scheme: 'usgs-magnitude', value: 'M6' },
      name: 'M 6.1 - 20 km S of Tecpan, Mexico', severity: 'Magnitude 6.1 mww, depth 10 km', placeIds: ['mx'], point: { lon: -100.6, lat: 17 }, url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1' };
    await create({ view: 'category', category: 'disaster', categories: ['disaster', 'wildfire'], events: [...EVENTS, quake] });
    const html = ds.details({ eventId: 'usgs:us1' });
    assert.match(html, /USGS alert · Disaster/);
    assert.match(html, /<span class="swatch"><\/span>Magnitude 6<\/span>/);
    assert.doesNotMatch(html, /Magnitude 6 · Normal/, 'a marker has no level of ours');
    assert.match(html, /Magnitude 6\.1 mww, depth 10 km/);
    assert.match(html, /USGS locates earthquakes worldwide within minutes/);
    assert.ok(ds.markers().some(m => m.id === 'usgs:us1' && m.kind === 'earthquake'));
    assert.match(ds.footer(), />USGS<|USGS/);
    assert.match(ds.details({ eventId: 'gdacs:TC:1' }), /Orange alert · High/, 'a GDACS alert keeps its level beside it');
  });

  test('a category mode\'s overview counts the alerts on the map', async () => {
    await create({ view: 'category', category: 'disaster', categories: ['disaster', 'wildfire'] });
    const shown = ds.markers().length;   // the markers the map shows, counted
    assert.match(ds.details(null), new RegExp(`<p class="block-note">${shown} alerts? on the map</p>`));
    await create();
    assert.doesNotMatch(ds.details(null), /on the map/, 'not in the highest mode (its markers are the major ones only)');
  });

  test('a category mode names that category in the badge and marks its row', async () => {
    await create({ view: 'category', category: 'disaster' });
    const html = ds.details({ placeId: 'so' });
    assert.match(html, /Disaster · Elevated/);
    assert.match(html, /<li class="is-focus">[\s\S]*?Disaster/);
    assert.match(html, /GDACS Orange alert: drought/);
  });
  test('advisory changes read like the travel card; a direction-only one says raised or lowered', () => {
    assert.match(ds.details({ placeId: 'so' }), /U\.S\.: Level 3 → 4/);
    assert.match(ds.details({ placeId: 'jp' }), /U\.S\.: lowered to Level 1/);
  });
  test('a level awaiting a confirmed fall says so instead of naming the alert', async () => {
    await create({ current: { ...CURRENT, places: { ...CURRENT.places, mx: { ...CURRENT.places.mx, disaster: { ...CURRENT.places.mx.disaster, falling: 1 } } } } });
    assert.match(ds.details({ placeId: 'mx' }), /Disaster<\/span>\s*<span class="lvl">High[\s\S]*?Lowering to Normal, awaiting confirmation/);
  });

  test('an unavailable source is named on the row; unsafe links are dropped', async () => {
    const down = { sources: ['gdacs'], default: null, status: 'error' };
    await create({ current: { ...CURRENT, categories: { ...CURRENT.categories, disaster: down, wildfire: down } } });
    assert.match(ds.details({ placeId: 'jp' }), /Disaster<\/span>\s*<span class="lvl">No data[\s\S]*Source unavailable/);
    assert.doesNotMatch(ds.footer(), /javascript:/);
  });
});

describe('texts', () => {
  test('header: the data age, and a source that is not healthy', async () => {
    assert.equal(ds.header(), 'Updated 2 hours ago');
    assert.equal(ds.stale(), false);
    await create({ current: { ...CURRENT, categories: { ...CURRENT.categories, disaster: { ...CURRENT.categories.disaster, status: 'delayed' } } } });
    assert.equal(ds.header(), 'GDACS delayed · Updated 2 hours ago', 'the issue first: an ellipsis cuts the end');
    await create({ view: 'category', category: 'conflict', current: { ...CURRENT, categories: { ...CURRENT.categories, disaster: { ...CURRENT.categories.disaster, status: 'error' } } } });
    assert.equal(ds.header(), 'Updated 2 hours ago', 'only this mode\'s categories count');
  });
  test('header: data over 12 hours old is flagged as delayed', async () => {
    assert.equal(isStale(hoursAgo(12), NOW, 12), false);
    assert.equal(isStale(hoursAgo(13), NOW, 12), true);
    await create({ current: { ...CURRENT, asOf: hoursAgo(13), categories: { ...CURRENT.categories, disaster: { ...CURRENT.categories.disaster, status: 'delayed' } } } });
    assert.equal(ds.stale(), true);
    assert.equal(ds.header(), 'GDACS delayed · Updated 13 hours ago: newer data is delayed');
  });
  test('footer: one line, the mode\'s sources linked and "How it works" (that the levels are ours is in the help)', async () => {
    const html = ds.footer();
    assert.match(html, /^Sources: .*<a href="https:\/\/www\.gdacs\.org\/"[^>]*>GDACS<\/a>.* · <button class="link-btn" data-action="help">How it works<\/button>$/);
    assert.match(html, /U\.S\./, 'All: every category\'s sources');
    assert.doesNotMatch(html, /not official levels/);
    await create({ view: 'category', category: 'disaster', categories: ['disaster', 'wildfire'] });
    assert.match(ds.footer(), /GDACS/);
    assert.doesNotMatch(ds.footer(), /U\.S\./, 'Disasters: its own sources only');
  });
  test('tooltip, map label and legend', () => {
    assert.match(ds.tooltip('mx'), /<strong>Mexico<\/strong>.*High · Disaster.*Disaster: Normal → High · 5 hours ago/);
    assert.doesNotMatch(ds.tooltip('aq'), /arrow/);
    assert.equal(ds.mapLabel(), 'World map coloured by risk level (All)');
    assert.match(ds.legend(), /Normal.*Elevated.*High.*Critical.*No data.*Level changed ≤ 30 days/);
  });
  test('search lists every place with its level, then the active alerts by name', () => {
    const entries = ds.searchEntries();
    const placeEntries = entries.filter(e => !e.target.eventId);
    assert.equal(placeEntries.length, PLACES.size);
    assert.deepEqual(placeEntries.find(e => e.target.placeId === 'mx'), { label: 'Mexico', aliases: ['Mexico'], swatch: 'var(--l3)', sub: 'High', target: { placeId: 'mx' } });
    const alerts = entries.filter(e => e.target.eventId);
    assert.equal(entries.indexOf(alerts[0]), PLACES.size, 'after the places');
    assert.deepEqual(alerts.map(e => e.target.eventId), ['gdacs:TC:1', 'gdacs:EQ:2', 'gdacs:EQ:9', 'gdacs:DR:3']);
    assert.deepEqual(alerts[0], { label: 'Tropical Cyclone <b>X</b>', aliases: ['tropical cyclone'], swatch: 'var(--l3)', sub: 'Orange alert · tropical cyclone', target: { eventId: 'gdacs:TC:1', placeId: 'mx' } });
    assert.deepEqual(alerts[2].target, { eventId: 'gdacs:EQ:9' }, 'an offshore alert: no place');
    assert.equal(ds.searchPlaceholder(), 'Find a country or alert');
  });
  test('search leaves Green forest fires out (a generic name, hundreds of them); a category mode finds its own alerts', async () => {
    const fire = (id, value, level) => ({ id, source: 'gdacs', ...DATES, category: 'wildfire', type: 'wildfire', level, native: { scheme: 'gdacs-alert', value }, name: 'Forest fires in Mexico', placeIds: ['mx'] });
    const files = { 'risk/current.json': CURRENT, 'risk/changes.json': { changes: CHANGES }, 'risk/events.json': { events: [...EVENTS, fire('gdacs:WF:1', 'Green', 1), fire('gdacs:WF:2', 'Orange', 3)] } };
    const make = async (options) => {
      const mode = createRiskMode({ i18n: createI18n({ locale: 'en', messages: EN }), settings: createSettings('k5', {}, { getItem: () => null, setItem: () => {} }), client: { file: async (p) => files[p] }, manifest: MANIFEST, places: PLACES, changed() {}, now: () => NOW, ...options });
      await mode.load();
      return mode.searchEntries().filter(e => e.target.eventId).map(e => e.target.eventId);
    };
    assert.deepEqual(await make({ mode: 'highest', view: 'highest' }), ['gdacs:TC:1', 'gdacs:EQ:2', 'gdacs:EQ:9', 'gdacs:WF:2', 'gdacs:DR:3'], 'the Orange fire, not the Green one; most severe first (the drought is Elevated)');
    assert.deepEqual(await make({ mode: 'disaster', view: 'category', category: 'disaster', categories: ['disaster', 'wildfire'] }), ['gdacs:TC:1', 'gdacs:EQ:2', 'gdacs:EQ:9', 'gdacs:WF:2', 'gdacs:DR:3'], 'Disasters finds the Orange fire too');
    assert.deepEqual(await make({ mode: 'wars', view: 'category', category: 'conflict' }), [], 'a category without alerts');
  });
  test('the event name is escaped wherever it appears', async () => {
    const f = fakeFeed();
    await create({ saved: { recentDays: 90 } });
    ds.renderFeed(f.el);
    assert.doesNotMatch(f.el.innerHTML, /<b>/);
  });
});

describe('the window switch', () => {
  test('the Latest changes block offers 7, 30 and 90 days; a click sets the window', () => {
    const f = fakeFeed();
    ds.renderFeed(f.el);
    assert.deepEqual(WINDOWS, [7, 30, 90]);
    assert.deepEqual([...f.tools.innerHTML.matchAll(/data-days="(\d+)" aria-checked="(\w+)">([^<]+)</g)].map(m => m.slice(1)), [['7', 'false', '7d'], ['30', 'true', '30d'], ['90', 'false', '90d']]);
    f.tools.onclick({ target: { closest: () => ({ dataset: { days: '7' } }) } });
    assert.equal(changes, 1);
    assert.equal(JSON.parse(storage.get('travel-risk-map:settings')).risk.recentDays, 7);
    f.tools.onclick({ target: { closest: () => null } });
    assert.equal(changes, 1);
  });
});

describe('Disasters (with wildfires)', () => {
  test('the level is the higher of the two; markers, the list, the feed and the tooltip take both', async () => {
    const fire = { id: 'gdacs:WF:7', source: 'gdacs', ...DATES, category: 'wildfire', type: 'wildfire', level: 3, native: { scheme: 'gdacs-alert', value: 'Orange' }, name: 'Forest fires in Japan', placeIds: ['jp'], point: { lon: 139, lat: 36 } };
    const current = { ...CURRENT, places: { ...CURRENT.places, jp: { ...CURRENT.places.jp, wildfire: { level: 3, basis: ['gdacs:WF:7'] } } } };
    const fireChange = { id: `jp:wildfire:${hoursAgo(3)}`, at: hoursAgo(3), kind: 'level', category: 'wildfire', placeId: 'jp', from: 1, to: 3, up: true, basis: ['gdacs:WF:7'] };
    const files = { 'risk/current.json': current, 'risk/changes.json': { changes: [fireChange, ...CHANGES] }, 'risk/events.json': { events: [fire, ...EVENTS] } };
    const mode = createRiskMode({ i18n: createI18n({ locale: 'en', messages: EN, today: new Date(NOW) }), settings: createSettings('k6', {}, { getItem: () => null, setItem() {} }), client: { file: async (p) => files[p] },
      manifest: MANIFEST, places: PLACES, changed() {}, mode: 'disaster', view: 'category', category: 'disaster', categories: ['disaster', 'wildfire'], now: () => NOW });
    await mode.load();
    assert.equal(levelIn(current, 'jp', new Set(['disaster', 'wildfire'])), 3);
    assert.equal(levelIn(current, 'xx', ['travel']), null, 'no data in any');
    assert.equal(mode.style('jp').cls, 'l3');
    assert.ok(mode.style('jp').pulse > 0, 'a wildfire level change pulses here');
    assert.deepEqual(mode.markers().map(m => m.id), ['gdacs:WF:7']);
    assert.match(mode.tooltip('jp'), /Disaster · High/);
    const f = fakeFeed();
    mode.renderFeed(f.el);
    assert.match(f.el.innerHTML, /Wildfire: Normal → High/);
    assert.equal(countryRows(current, [fireChange], ['jp'], { categories: new Set(['disaster', 'wildfire']) })[0].level, 3);
  });
});

describe('feed grouping', () => {
  test('a place\'s changes in a category are one row, by its newest; other categories and placeless alerts stay apart', () => {
    const at = (h) => hoursAgo(h);
    const list = [
      { id: 'a', at: at(1), kind: 'level', category: 'disaster', placeId: 'mx' },
      { id: 'b', at: at(2), kind: 'event', category: 'disaster', placeIds: ['mx'] },
      { id: 'c', at: at(3), kind: 'advisory', category: 'travel', placeIds: ['mx', 'gt'] },
      { id: 'd', at: at(4), kind: 'event', category: 'disaster', placeIds: [] },
      { id: 'e', at: at(5), kind: 'event', category: 'disaster', placeIds: [] },
      { id: 'f', at: at(6), kind: 'level', category: 'disaster', placeId: 'mx' },
    ];
    assert.deepEqual(groupFeed(list).map(g => [g.change.id, g.count]), [['a', 3], ['c', 1], ['d', 1], ['e', 1]]);
    assert.deepEqual(groupFeed([]), []);
  });
});

describe('feed', () => {
  test('lists the window\'s changes newest first, of every kind, with their place', () => {
    const f = fakeFeed();
    ds.renderFeed(f.el);
    assert.equal(f.section.hidden, false);
    assert.equal(f.title.textContent, 'Latest changes');
    assert.equal(f.count.textContent, 4, 'Mexico\'s level change and its cyclone alert are one row');
    const first = f.el.innerHTML.match(/data-key="([^"]+)"/)[1];
    assert.deepEqual(ds.feedTarget(first), { placeId: 'mx' });
    const names = [...f.el.innerHTML.matchAll(/class="name">([^<]+)</g)].map(m => m[1]);
    assert.deepEqual(names, ['Mexico', 'Offshore quake', 'Somalia', 'Kenya']);
    assert.match(f.el.innerHTML, /Disaster: Normal → High<span class="earlier"> · and 1 earlier<\/span>/);
    assert.match(f.el.innerHTML, /GDACS earthquake: lowered to Orange alert/);
    assert.match(f.el.innerHTML, /5h ago/);
  });
  test('filters by the shown levels and the mode\'s category; nothing shown is the heading and 0', async () => {
    const f = fakeFeed();
    await create({ view: 'category', category: 'disaster' });
    ds.renderFeed(f.el);
    const disaster = f.count.textContent;
    await create();
    ds.renderFeed(f.el);
    assert.ok(disaster < f.count.textContent, `the category's changes only (${disaster} of ${f.count.textContent})`);
    await create({ saved: { levels: [1] } });
    ds.renderFeed(f.el);
    assert.equal(f.el.innerHTML, '', 'nothing on the shown levels: the heading and 0');
    assert.equal(f.count.textContent, 0);
  });
  test('names a change on several places by the first and a count, and caps a long list', async () => {
    // Alerts on no place: a row each (a place's changes would be one row).
    const many = Array.from({ length: 55 }, (_, i) => ({ id: `c${i}`, at: hoursAgo(i), kind: 'event', category: 'disaster', source: 'gdacs', eventId: `gdacs:EQ:${100 + i}`, type: 'earthquake', placeIds: [], to: 3, native: 'Orange', new: true }));
    const wide = { id: 'wide', at: hoursAgo(1), kind: 'event', category: 'disaster', source: 'gdacs', eventId: 'gdacs:DR:3', type: 'drought', placeIds: ['ke', 'so'], to: 2, native: 'Orange', new: true };
    const files = { 'risk/current.json': CURRENT, 'risk/changes.json': { changes: [wide, ...many] }, 'risk/events.json': { events: EVENTS } };
    const settings = createSettings('k', {}, { getItem: () => null, setItem: () => {} });
    const mode = createRiskMode({ i18n: createI18n({ locale: 'en', messages: EN }), settings, client: { file: async (p) => files[p] }, manifest: MANIFEST, places: PLACES, changed() {}, mode: 'highest', view: 'highest', now: () => NOW });
    await mode.load();
    const f = fakeFeed();
    mode.renderFeed(f.el);
    assert.match(f.el.innerHTML, /Kenya \+1/);
    assert.equal((f.el.innerHTML.match(/data-key=/g) ?? []).length, 8, 'the first 8');
    assert.match(f.el.innerHTML, /<button class="link-btn" data-feed-all>Show all 56<\/button>/);
    f.el.onclick({ target: { closest: () => null } });
    assert.equal((f.el.innerHTML.match(/data-key=/g) ?? []).length, 8, 'another click changes nothing');
    f.el.onclick({ target: { closest: (sel) => (sel === '[data-feed-all]' ? {} : null) } });
    assert.equal((f.el.innerHTML.match(/data-key=/g) ?? []).length, 50, 'then up to 50');
    assert.match(f.el.innerHTML, /and 6 more/);
    assert.doesNotMatch(f.el.innerHTML, /data-feed-all/);
  });
  test('maps feed items to places and back', () => {
    assert.deepEqual(ds.feedTarget('advisory:us:Somalia:2026-09-20'), { placeId: 'so' });
    assert.deepEqual(ds.feedTarget(`gdacs:EQ:9:${hoursAgo(30)}`), { eventId: 'gdacs:EQ:9' }, 'offshore: the event itself');
    assert.equal(ds.feedTarget('nope'), null);
    assert.equal(ds.feedKeyFor({ placeId: 'mx' }), CHANGES[0].id);
    assert.equal(ds.feedKeyFor({ placeId: 'jp' }), null);
    assert.equal(ds.feedKeyFor(null), null);
  });
});

describe('markers', () => {
  test('clusters markers in the same screen cell, at their average position and highest level', () => {
    const list = clusterMarkers([
      { id: 'b', x: 10, y: 10, level: 1 }, { id: 'a', x: 20, y: 14, level: 3 }, { id: 'c', x: 100, y: 10, level: 4 }, { id: 'd', x: 5, y: 60 },
    ]);
    assert.deepEqual(list.map(c => [c.id, c.items.length, c.level]), [['d', 1, 1], ['cluster:a|b', 2, 3], ['c', 1, 4]], 'lowest level first, so the highest draws on top');
    assert.deepEqual([list[1].x, list[1].y], [15, 12]);
    assert.deepEqual(clusterMarkers([]), []);
    for (const kind of ['earthquake', 'cyclone', 'flood', 'volcano', 'drought', 'wildfire', 'default']) assert.match(MARKER_ICONS[kind], /^M/, kind);
  });

  const withPoints = EVENTS.map((e, i) => ({ ...e, category: e.type === 'drought' || e.type === 'earthquake' || e.type === 'cyclone' ? 'disaster' : 'wildfire', point: i === 2 ? undefined : { lon: i, lat: i } }));
  async function withEvents(opts) {
    await create(opts);
    // Replace the loaded events with ones that have positions (the fixture's have none).
    const files = { 'risk/current.json': CURRENT, 'risk/changes.json': { changes: CHANGES }, 'risk/events.json': { events: withPoints } };
    const settings = createSettings('k', {}, { getItem: () => null, setItem: () => {} });
    ds = createRiskMode({ i18n: createI18n({ locale: 'en', messages: EN, today: new Date(NOW) }), settings, client: { file: async (p) => files[p] }, manifest: MANIFEST, places: PLACES, changed() {}, now: () => NOW, ...opts, mode: opts.mode ?? opts.category ?? opts.view });
    await ds.load();
  }

  test('a category mode marks its events, the highest mode only major ones', async () => {
    await withEvents({ view: 'category', category: 'disaster' });
    assert.deepEqual(ds.markers().map(m => m.id), ['gdacs:TC:1', 'gdacs:EQ:2', 'gdacs:DR:3'], 'events without a position are left out');
    assert.deepEqual(ds.markers()[0], { id: 'gdacs:TC:1', lon: 0, lat: 0, kind: 'cyclone', level: 3 });
    await withEvents({ view: 'highest' });
    assert.deepEqual(ds.markers().map(m => m.id), ['gdacs:TC:1', 'gdacs:EQ:2']);
    await withEvents({ view: 'category', category: 'conflict' });
    assert.deepEqual(ds.markers(), [], 'no events in this category');
  });

  test('a marker selects its event on its first place; its tooltip names it, a cluster lists them', async () => {
    await withEvents({ view: 'category', category: 'disaster' });
    assert.deepEqual(ds.eventTarget('gdacs:TC:1'), { eventId: 'gdacs:TC:1', placeId: 'mx' });
    assert.deepEqual(ds.eventTarget('gdacs:EQ:9'), { eventId: 'gdacs:EQ:9' }, 'offshore: no place');
    assert.equal(ds.eventTarget('nope'), null);
    assert.match(ds.markerTooltip(['gdacs:TC:1']), /<strong>Tropical Cyclone &lt;b&gt;X&lt;\/b&gt;<\/strong>.*Orange alert · High · tropical cyclone/);
    const five = ds.markerTooltip(['gdacs:TC:1', 'gdacs:EQ:2', 'gdacs:EQ:9', 'gdacs:DR:3', 'gdacs:TC:1']);
    assert.match(five, /5 alerts here/);
    assert.match(five, /and 1 more/);
  });

  test('the event card shows the source\'s facts with our level, where it is, and a safe link', async () => {
    const html = ds.details({ eventId: 'gdacs:TC:1', placeId: 'mx' });
    assert.match(html, /GDACS alert · Disaster/);
    assert.match(html, /Tropical Cyclone &lt;b&gt;X&lt;\/b&gt;/);
    assert.match(html, /Orange alert · High/);
    assert.match(html, /Affects<\/dt><dd[^>]*>Mexico/);
    assert.match(html, /automatic estimates/);
    assert.match(html, /href="https:\/\/www\.gdacs\.org\/report\.aspx\?eventid=1"/);
    const offshore = ds.details({ eventId: 'gdacs:EQ:9' });
    assert.match(offshore, /At sea, no country/);
    assert.doesNotMatch(ds.details({ eventId: 'gdacs:EQ:2' }), /javascript:/);
    assert.match(ds.details({ eventId: 'gone', placeId: 'mx' }), /Risk by category/, 'an event no longer active: the place card');
  });

  test('a feed item about an event targets the event, and the event finds its feed item', () => {
    assert.deepEqual(ds.feedTarget(CHANGES[1].id), { eventId: 'gdacs:TC:1', placeId: 'mx' });
    assert.deepEqual(ds.feedTarget(CHANGES[2].id), { eventId: 'gdacs:EQ:9' }, 'offshore events can be selected too');
    assert.equal(ds.feedKeyFor({ eventId: 'gdacs:TC:1', placeId: 'mx' }), CHANGES[1].id);
    assert.equal(ds.feedKeyFor({ eventId: 'gdacs:none', placeId: 'mx' }), CHANGES[0].id, 'falls back to the place');
  });

  test('the legend explains the markers', async () => {
    assert.match(ds.legend(), /legend-marker/);
  });
});

describe('a selected place\'s blocks', () => {
  const container = () => ({ innerHTML: '' });
  const click = (el, attrs) => el.onclick({ target: { closest: (sel) => {
    const m = sel.match(/^\[data-(\w+)(?:="(\w+)")?\]$/);
    if (!m) return null;
    const [, name, value] = m;
    if (!(name in attrs) || (value && attrs[name] !== value)) return null;
    return { dataset: { [name]: String(attrs[name]) } };
  } } });

  test('blocks from the place file: armed violence, each government in its own words, the active alerts', async () => {
    const el = container();
    el.innerHTML = await ds.placeBlocks('mx');
    assert.deepEqual(requested.at(-1), ['risk/places/mx.json', CURRENT.asOf], 'the place file, versioned');
    const html = el.innerHTML;
    assert.ok((html.match(/<section class="card block cv-section">/g) ?? []).length >= 3, 'each one a block');
    assert.doesNotMatch(html, /cv-name|data-action="back"|data-history/, 'no head, Back or history window: the selected block above has them');
    assert.match(html, /Active alerts <span class="count">2<\/span>/);
    assert.match(html, /Orange alert: Tropical Cyclone &lt;b&gt;X&lt;\/b&gt;/);
    assert.match(html, /U\.S\.<\/span>[\s\S]*Level 2 · Exercise increased caution/);
    assert.match(html, /Level 3 · Avoid non-essential travel · under North &lt;America&gt;/, 'a covering advisory says so');
    assert.match(html, /href="https:\/\/travel\.state\.gov\/mx"/);
    assert.match(html, /src="assets\/flags\/gb\.svg"/, 'a flag code that differs from the provider id');
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /<button data-event="gdacs:TC:1"/, 'an alert is a button to its card (main.js selects it)');
    assert.doesNotMatch(await ds.placeBlocks('mx', { mode: 'wars' }), /Armed violence \(UCDP\)/, 'Wars: its own block above has it');
  });

  test('armed violence: deaths by month, the conflicts with links to UCDP, and the violence no government is a side of', async () => {
    const el = container();
    el.innerHTML = await ds.placeBlocks('ke');
    const html = el.innerHTML;
    const section = html.split('Armed violence (UCDP)')[1].split('</section>')[0];
    assert.ok(html.indexOf('Armed violence (UCDP)') < html.indexOf('Travel advisories'), 'first');
    assert.match(section, /Normal · 30 deaths in 12 months/);
    assert.equal((section.match(/<rect /g) ?? []).length, 12);
    assert.match(section, /<title>August 2026: 30<\/title>/);
    assert.match(section, /Kenya vs Al-Shabaab, IS \+1 · 20 deaths<\/span><a href="https:\/\/ucdp\.uu\.se\/conflict\/5"/, 'who fights whom: the first two of a side, the unidentified left out');
    assert.match(section, /Party to Kenya: unnamed armed group · war · mostly in Somalia/, 'a war it is a party to, fought elsewhere; listed once');
    assert.equal((section.match(/<li>/g) ?? []).length, 2, 'the conflict fought here is not repeated as one it is a party to');
    assert.match(section, /Also 5 killed between armed groups and 5 in attacks on civilians\./);
    assert.match(section, /Preliminary figures/);
    const mx = container();
    mx.innerHTML = await ds.placeBlocks('mx');
    assert.match(mx.innerHTML, /Armed violence \(UCDP\)<\/h3><p class="cv-empty">UCDP recorded no deaths in organized violence here in the 12 months to August 2026\./);
  });

  const ids = (rows) => rows.map(r => r.placeId);
  const name = (id) => PLACES.get(id).name;
  test('the countries list: each place\'s level, what set it, and its latest level change', () => {
    const rows = countryRows(CURRENT, CHANGES, PLACES.keys());
    assert.deepEqual(rows.find(r => r.placeId === 'mx'), { placeId: 'mx', level: 3, by: ['disaster'], latest: CHANGES[0] });
    assert.deepEqual(rows.find(r => r.placeId === 'ke').by, ['travel', 'disaster']);
    assert.equal(rows.find(r => r.placeId === 'aq').latest, null);
    const disaster = countryRows(CURRENT, CHANGES, PLACES.keys(), { categories: new Set(['disaster']) });
    assert.deepEqual(disaster.find(r => r.placeId === 'so'), { placeId: 'so', level: 2, by: [], latest: null }, 'a travel change is not a disaster change');
    assert.equal(countryRows(CURRENT, CHANGES, ['aq'], { categories: new Set(['travel']) })[0].level, null, 'no data');
  });
  test('sorts by level, by latest change, or by name; ties go to the newer change, then the name', () => {
    const rows = countryRows(CURRENT, CHANGES, PLACES.keys());
    assert.deepEqual(ids(sortRows(rows, 'level', name)), ['so', 'mx', 'ke', 'jp', 'aq'], 'Japan changed, Antarctica never');
    assert.deepEqual(ids(sortRows(rows, 'recent', name)), ['mx', 'so', 'ke', 'jp', 'aq']);
    assert.deepEqual(ids(sortRows(rows, 'name', name)), ['aq', 'jp', 'ke', 'mx', 'so']);
    assert.deepEqual(ids(sortRows(rows, 'nope', name)), ['aq', 'jp', 'ke', 'mx', 'so'], 'unknown: by name');
    const noData = countryRows(CURRENT, [], ['aq', 'jp'], { categories: new Set(['travel']) });
    assert.deepEqual(ids(sortRows(noData, 'level', name)), ['jp', 'aq'], 'no data last');
    assert.equal(rows.length, PLACES.size, 'a copy: the input is left alone');
  });

  const listContainer = () => {
    const els = { '#listFilter': { value: '' }, '#listRows': { innerHTML: '' }, '#listCount': { textContent: '' } };
    return { innerHTML: '', els, querySelector: (sel) => els[sel], querySelectorAll: () => [] };
  };
  const listed = (el) => [...el.els['#listRows'].innerHTML.matchAll(/data-place="(\w+)"/g)].map(m => m[1]);
  test('renders the list sorted by the saved order, filters by name, and saves a new order', async () => {
    let el = listContainer();
    ds.renderCountryList(el, { open() {}, back() {}, hover() {} });
    assert.match(el.innerHTML, /Countries · All/);
    assert.match(el.innerHTML, /data-sort="level" aria-checked="true"/);
    assert.deepEqual(listed(el), ['so', 'mx', 'ke', 'jp', 'aq']);
    assert.equal(el.els['#listCount'].textContent, 5);
    assert.match(el.els['#listRows'].innerHTML, /Mexico<\/span>\s*<span class="lvl">High · Disaster<\/span>[\s\S]*▲<\/span> 5h ago/);
    click(el, { sort: 'name' });
    assert.deepEqual(listed(el), ['aq', 'jp', 'ke', 'mx', 'so']);
    assert.equal(JSON.parse(storage.get('travel-risk-map:settings')).risk.listSort, 'name');
    el.els['#listFilter'].value = 'ke';
    el.els['#listFilter'].oninput();
    assert.deepEqual(listed(el), ['ke']);
    assert.equal(el.els['#listCount'].textContent, '1 of 5');
    el.els['#listFilter'].value = 'zzz';
    el.els['#listFilter'].oninput();
    assert.match(el.els['#listRows'].innerHTML, /No matches/);
    await create({ view: 'category', category: 'disaster', saved: { listSort: 'bogus' } });
    el = listContainer();
    ds.renderCountryList(el, { open() {}, back() {}, hover() {} });
    assert.deepEqual(listed(el).slice(0, 3), ['mx', 'ke', 'so'], 'disaster levels; an unknown saved order is reset to level');
    assert.match(el.els['#listRows'].innerHTML, /Somalia<\/span>\s*<span class="lvl">Elevated<\/span>/, 'a category mode: the level alone');
  });
  test('the list opens a country, goes back, and previews the hovered place', () => {
    const el = listContainer();
    const calls = [];
    ds.renderCountryList(el, { open: (id) => calls.push(['open', id]), back: () => calls.push(['back']), hover: (id) => calls.push(['hover', id]) });
    click(el, { place: 'jp' });
    click(el, { action: 'back' });
    click(el, {});
    el.onpointerover({ target: { closest: () => ({ dataset: { place: 'mx' } }) } });
    el.onpointerover({ target: { closest: () => null } });
    el.onpointerleave();
    assert.deepEqual(calls, [['open', 'jp'], ['back'], ['hover', 'mx'], ['hover', null], ['hover', null]]);
  });

  test('without a place file: the loaded alerts; no alerts, no alerts block', async () => {
    const el = container();
    el.innerHTML = await ds.placeBlocks('so');
    assert.match(el.innerHTML, /Active alerts <span class="count">1<\/span>/, 'the drought');
    assert.match(el.innerHTML, /No advisory/, 'no advisories without the file');
    el.innerHTML = await ds.placeBlocks('aq');
    assert.doesNotMatch(el.innerHTML, /Active alerts/);
  });

});

describe('WHO notices on the site', () => {
  const NOTICE = {
    id: 'who:DON:2026-DON618', source: 'who', type: 'outbreak', category: 'health', level: 2, native: { scheme: 'who-don', value: 'notice' },
    name: 'Ebola disease - Mexico', placeIds: ['mx'], startedAt: '2026-09-25T15:30:18.000Z', toDate: '2026-09-25T15:30:18.000Z', current: false,
    url: 'https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON618',
  };
  const HEALTH = { ...CURRENT, categories: { ...CURRENT.categories, health: { sources: ['who'], default: 1, status: 'healthy' } },
    places: { ...CURRENT.places, mx: { ...CURRENT.places.mx, health: { level: 2, basis: [NOTICE.id] } } } };
  async function withNotice() {
    const files = { 'risk/current.json': HEALTH, 'risk/changes.json': { changes: [] }, 'risk/events.json': { events: [NOTICE] } };
    const settings = createSettings('k', {}, { getItem: () => null, setItem: () => {} });
    ds = createRiskMode({ i18n: createI18n({ locale: 'en', messages: EN, today: new Date(NOW) }), settings, client: { file: async (p) => files[p] }, manifest: MANIFEST, places: PLACES, changed() {}, mode: 'highest', view: 'highest', now: () => NOW });
    await ds.load();
  }

  test('the card has a health row naming the notice, and its report link names WHO', async () => {
    await withNotice();
    const html = ds.details({ placeId: 'mx' });
    assert.match(html, /Health<\/span>\s*<span class="lvl">Elevated[\s\S]*WHO Disease Outbreak News: disease outbreak/);
    assert.match(html, /href="https:\/\/www\.who\.int\/emergencies\/disease-outbreak-news\/item\/2026-DON618"[^>]*>WHO report ↗/);
  });
  test('a notice\'s event card has one date and WHO\'s own note', async () => {
    await withNotice();
    const html = ds.details({ eventId: NOTICE.id });
    assert.match(html, /WHO alert · Health/);
    assert.match(html, /Disease Outbreak News · Elevated/);
    assert.match(html, /Published<\/dt><dd[^>]*>Sep 25, 2026/);
    assert.doesNotMatch(html, /Started|Ended/);
    assert.match(html, /WHO publishes Disease Outbreak News/);
    assert.doesNotMatch(html, /automatic estimates/);
  });
});

describe('news activity on the site', () => {
  const ACTIVITY = { gdelt: { through: '2026-09-27', learning: false, windowDays: 7, baselineDays: 84, places: { mx: { protest: { status: 'far', count: 18, expected: 4 }, violence: { status: 'above', count: 12, expected: 1.2 } } } } };
  const ANOMALY = { id: 'mx:protest:2026-09-27', at: '2026-09-27', kind: 'anomaly', category: 'unrest', placeId: 'mx', series: 'protest', source: 'gdelt', from: 'normal', to: 'far', up: true, count: 18, expected: 4 };
  async function withActivity({ activity = ACTIVITY, file = { ...MX_FILE, activity: { source: 'gdelt', series: ACTIVITY.gdelt.places.mx } }, levels } = {}) {
    const files = {
      'risk/current.json': { ...CURRENT, sources: { ...CURRENT.sources, gdelt: { url: 'https://www.gdeltproject.org/' } }, activity },
      'risk/changes.json': { changes: [ANOMALY, ...CHANGES] }, 'risk/events.json': { events: EVENTS }, 'risk/places/mx.json': file,
    };
    const storage = new Map(levels ? [['k', JSON.stringify({ risk: { levels } })]] : []);
    const settings = createSettings('k', {}, { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) });
    ds = createRiskMode({ i18n: createI18n({ locale: 'en', messages: EN, today: new Date(NOW) }), settings, client: { file: async (p) => files[p] }, manifest: MANIFEST, places: PLACES, changed() {}, mode: 'highest', view: 'highest', now: () => NOW });
    await ds.load();
  }

  test('the card says what is unusual in its "later" slot, and never gives it a level', async () => {
    await withActivity();
    const html = ds.details({ placeId: 'mx' });
    assert.match(html, /<p class="later news"[^>]*>News: Protest reports far above normal · Violence reports above normal \(GDELT\)<\/p>/);
    assert.doesNotMatch(html, /<span class="cat">(Unrest|Security)/, 'no category row');
    assert.match(ds.details({ placeId: 'jp' }), /<p class="later">News: no unusual activity \(GDELT\)<\/p>/, 'nothing unusual: says so');
  });

  test('the news block shows each series\' week against its normal, a percentage only from 2 expected', async () => {
    await withActivity();
    const el = { innerHTML: '' };
    el.innerHTML = await ds.placeBlocks('mx');
    assert.match(el.innerHTML, /News activity/);
    assert.match(el.innerHTML, /18 in the last 7 days, usually about 4 \(\+350%\)/);
    assert.match(el.innerHTML, /12 in the last 7 days, usually about 1\.2</, 'no percentage from an expected 1.2');
    assert.match(el.innerHTML, /far above normal/);
    assert.match(el.innerHTML, /not verified incidents, compared with this country&#39;s own last 12 weeks\. They never set a risk level\./);
  });

  test('the news block lists the place\'s tensions with other countries (military news above the pair\'s normal)', async () => {
    const tension = { key: 'KEN|SOM', status: 'above', count: 40, expected: 9.6, sides: [['ke'], ['so']] };
    await withActivity({ file: { ...MX_FILE, activity: { source: 'gdelt', series: ACTIVITY.gdelt.places.mx }, tensions: [tension] } });
    const el = { innerHTML: '' };
    el.innerHTML = await ds.placeBlocks('mx');
    assert.match(el.innerHTML, /Tensions with other countries<\/h4><ul class="cv-list tensions"><li class="activity above"><span class="who">Kenya – Somalia<\/span>/);
    assert.match(el.innerHTML, /40 military reports between them in 7 days, usually about 10/);
    await withActivity({ file: MX_FILE });
    el.innerHTML = await ds.placeBlocks('mx');
    assert.doesNotMatch(el.innerHTML, /Tensions with other countries/);
  });

  test('while the baseline is being collected, or with no counts, the news block says so', async () => {
    await withActivity({ activity: { gdelt: { ...ACTIVITY.gdelt, learning: true, places: {} } } });
    const el = { innerHTML: '' };
    el.innerHTML = await ds.placeBlocks('mx');
    assert.match(el.innerHTML, /Collecting a baseline first/);
    await withActivity({ file: MX_FILE });
    el.innerHTML = await ds.placeBlocks('mx');
    assert.match(el.innerHTML, /No news reports of protests or violence counted here\./);
  });

  test('news activity is not listed as a change: not in the feed, tooltip or the card\'s history; the news block shows it as it is', async () => {
    await withActivity({ file: { ...MX_FILE, changes: [ANOMALY, ...MX_FILE.changes], activity: { source: 'gdelt', series: ACTIVITY.gdelt.places.mx } } });
    const f = fakeFeed();
    ds.renderFeed(f.el);
    assert.equal(f.count.textContent, 4, 'the changes (four rows), not the anomaly');
    assert.doesNotMatch(f.el.innerHTML, /mx:protest|GDELT/);
    assert.equal(ds.feedTarget('mx:protest:2026-09-27'), null, 'not a feed item');
    assert.doesNotMatch(ds.details(null), /Protest reports/, 'not in the latest changes');
    assert.doesNotMatch(ds.tooltip('mx'), /Protest reports/);
    assert.doesNotMatch(ds.details({ placeId: 'mx' }).split('Recent changes')[1], /Protest reports/, 'not in the card history');
    const el = { innerHTML: '' };
    el.innerHTML = await ds.placeBlocks('mx');
    assert.match(el.innerHTML, /far above normal/, 'shown as it is now, in the news block');
  });
});
