// The risk modes (views and rules) with small fake risk files, real English messages, a fixed
// clock and in-memory settings. No browser needed.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRiskMode, WINDOWS } from '../../../site/js/datasets/risk/index.js';
import {
  changeTime, ageHours, changePlaces, direction, levelOf, highest, filterChanges, changesFor, pulseOpacity, countByLevel,
  countDirections, cardModel, isStale, countryRows, sortRows, newsRows, isNews,
} from '../../../site/js/datasets/risk/logic.js';
import { MODES } from '../../../site/js/datasets/registry.js';
import { clusterMarkers, MARKER_ICONS } from '../../../site/js/map/clusters.js';
import { createI18n } from '../../../site/js/core/i18n.js';
import { createSettings } from '../../../site/js/core/settings.js';
import { parseHash, formatHash } from '../../../site/js/core/url-state.js';

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
const CONFLICT = { source: 'ucdp', through: '2026-08', places: { so: { deaths12: 3304 }, ke: { deaths12: 1 } } };
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
async function create({ view = 'highest', category, mode = view === 'category' ? category : view, saved = {}, current = CURRENT } = {}) {
  storage = new Map(Object.entries({ 'travel-risk-map:settings': JSON.stringify({ risk: saved }) }));
  const settings = createSettings('travel-risk-map:settings', {}, { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) });
  requested = [];
  const files = { 'risk/current.json': current, 'risk/changes.json': { changes: CHANGES }, 'risk/events.json': { events: EVENTS }, 'risk/conflict.json': CONFLICT, 'risk/places/mx.json': MX_FILE };
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

// A stand-in for a DOM element: enough for renderSettings/renderFeed and their click handlers.
function fakeFeed() {
  const title = { textContent: '' }, count = { textContent: '' };
  const section = { hidden: true, querySelector: (sel) => (sel === '#recentTitle' ? title : count) };
  return { el: { innerHTML: '', closest: () => section }, section, title, count };
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
    assert.deepEqual(parseHash('#mode=disaster&place=mx'), { mode: 'disaster', place: 'mx', view: null });
    assert.deepEqual(parseHash(''), { mode: null, place: null, view: null });
    assert.deepEqual(parseHash(undefined), { mode: null, place: null, view: null });
    assert.equal(formatHash({ mode: 'travel' }), '#mode=travel');
    assert.equal(formatHash({ mode: 'disaster', place: 'mx' }), '#mode=disaster&place=mx');
    assert.equal(formatHash({}), '');
    assert.deepEqual(parseHash('#mode=highest&place=mx&view=country'), { mode: 'highest', place: 'mx', view: 'country' });
    assert.equal(formatHash({ mode: 'highest', place: 'mx', view: 'country' }), '#mode=highest&place=mx&view=country');
    assert.equal(formatHash({ mode: 'highest', view: 'country' }), '#mode=highest', 'a country view needs a place');
    assert.equal(formatHash({ mode: 'highest', view: 'list' }), '#mode=highest&view=list', 'the list does not');
    assert.deepEqual(parseHash('#mode=highest&view=list'), { mode: 'highest', place: null, view: 'list' });
  });
});

describe('modes registry', () => {
  test('offers travel always, and the risk modes only when the manifest has risk data', () => {
    const withRisk = { datasets: [{ id: 'travel-advisories' }], risk: MANIFEST };
    assert.deepEqual(MODES.filter(m => m.entry(withRisk)).map(m => m.id), ['travel', 'highest', 'disaster', 'wildfire', 'changes']);
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
  test('the changes mode fades places without a change in the window', async () => {
    await create({ view: 'changes' });
    assert.equal(ds.style('mx').dim, false);
    assert.equal(ds.style('jp').dim, true);
  });
  test('hidden levels are muted and do not pulse; fading and the direction filter apply', async () => {
    await create({ saved: { levels: [1, 2, 4] } });
    assert.equal(ds.style('mx').muted, true);
    assert.equal(ds.style('mx').pulse, null);
    await create({ saved: { dimOthers: true, direction: 'down' } });
    assert.equal(ds.style('mx').dim, true, 'its rise is filtered out');
    assert.equal(ds.style('ke').dim, false);
  });
  test('falls back to defaults for invalid saved settings', async () => {
    await create({ saved: { recentDays: 5, levels: 'x', direction: 'sideways' } });
    const saved = JSON.parse(storage.get('travel-risk-map:settings')).risk;
    assert.deepEqual([saved.recentDays, saved.levels, saved.direction], [30, [1, 2, 3, 4], 'all']);
  });
});

describe('details card', () => {
  test('the overview counts places per level and the rises and falls in the window', () => {
    const html = ds.details(null);
    assert.match(html, /World overview · Highest/);
    assert.match(html, /3 places above Normal/);
    assert.match(html, /In the last 30 days: .*<strong>2<\/strong> raised, .*<strong>1<\/strong> lowered\./);
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
    assert.match(html, /<button class="link link-btn" data-action="country" data-place="mx">Country details →<\/button>/);
    assert.match(ds.details(null), /<button class="link link-btn" data-action="list">All countries →<\/button>/, 'the overview opens the list');
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
  test('the overview lists the three latest changes, newest first, as buttons to their place', () => {
    const latest = ds.details(null).split('class="latest"')[1];
    assert.match(latest, /Latest changes/);
    assert.deepEqual([...latest.matchAll(/class="name">([^<]+)</g)].map(m => m[1]), ['Mexico', 'Mexico', 'Offshore quake']);
    const keys = [...latest.matchAll(/data-key="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(keys, ds.details(null).match(/data-key="([^"]+)"/g).map(k => k.slice(10, -1)));
    assert.deepEqual(ds.feedTarget(keys[0]), { placeId: 'mx' });
    assert.match(latest, /Disaster: Normal → High/);
  });
  test('an empty window says so and offers the longest one; at the longest it only says so', async () => {
    await create({ view: 'changes', saved: { recentDays: 1, levels: [1, 2] } });
    assert.match(ds.details(null), /No changes in this period\. <button class="link-btn" data-show-days="90">Show 90 days<\/button>/);
    const f = fakeFeed();
    ds.renderFeed(f.el);
    assert.match(f.el.innerHTML, /recent-empty">No changes in this period\. <button class="link-btn" data-show-days="90">/);
    ds.showWindow(90);
    assert.equal(changes, 1);
    assert.equal(JSON.parse(storage.get('travel-risk-map:settings')).risk.recentDays, 90);
    ds.renderFeed(f.el);
    assert.doesNotMatch(f.el.innerHTML + ds.details(null), /data-show-days/, 'nothing longer to offer');
  });
  test('a category mode\'s overview says what raises its level', async () => {
    await create({ view: 'category', category: 'wildfire' });
    assert.match(ds.details(null), /Levels rise only with a GDACS Orange or Red forest-fire alert, which is rare\. Green markers are smaller fires\./);
    assert.doesNotMatch(ds.details(null), /Hover or tap a country/, 'the note replaces the general hint (the card has room for one)');
    await create();
    assert.doesNotMatch(ds.details(null), /Levels rise/, 'not in the highest mode');
    assert.match(ds.details(null), /Hover or tap a country/, 'the highest mode has the general hint instead');
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
    assert.equal(ds.header(), 'Updated 2 hours ago · GDACS delayed');
    await create({ view: 'category', category: 'wildfire', current: { ...CURRENT, categories: { ...CURRENT.categories, disaster: { ...CURRENT.categories.disaster, status: 'error' } } } });
    assert.equal(ds.header(), 'Updated 2 hours ago', 'only this mode\'s categories count');
  });
  test('header: data over 12 hours old is flagged as delayed', async () => {
    assert.equal(isStale(hoursAgo(12), NOW, 12), false);
    assert.equal(isStale(hoursAgo(13), NOW, 12), true);
    await create({ current: { ...CURRENT, asOf: hoursAgo(13), categories: { ...CURRENT.categories, disaster: { ...CURRENT.categories.disaster, status: 'delayed' } } } });
    assert.equal(ds.stale(), true);
    assert.equal(ds.header(), 'Updated 13 hours ago: newer data is delayed · GDACS delayed');
  });
  test('footer: links every source and says the levels are ours', () => {
    const html = ds.footer();
    assert.match(html, /<a href="https:\/\/www\.gdacs\.org\/"[^>]*>GDACS<\/a>, U\.S\./);
    assert.match(html, /not official levels/);
  });
  test('tooltip, map label and legend', () => {
    assert.match(ds.tooltip('mx'), /<strong>Mexico<\/strong>.*High · Disaster.*Disaster: Normal → High · 5 hours ago/);
    assert.doesNotMatch(ds.tooltip('aq'), /arrow/);
    assert.equal(ds.mapLabel(), 'World map coloured by risk level (Highest)');
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
    assert.deepEqual(await make({ mode: 'wildfire', view: 'category', category: 'wildfire' }), ['gdacs:WF:2']);
  });
  test('the event name is escaped wherever it appears', async () => {
    const f = fakeFeed();
    await create({ saved: { recentDays: 90 } });
    ds.renderFeed(f.el);
    assert.doesNotMatch(f.el.innerHTML, /<b>/);
  });
});

describe('settings', () => {
  test('renders level chips, windows and directions, and applies clicks', () => {
    const el = { innerHTML: '' };
    ds.renderSettings(el);
    assert.equal((el.innerHTML.match(/data-level=/g) ?? []).length, 4);
    assert.deepEqual([...el.innerHTML.matchAll(/data-days="(\d+)"/g)].map(m => Number(m[1])), WINDOWS);
    assert.match(el.innerHTML, /data-days="30" aria-checked="true"/);
    assert.match(el.innerHTML, /24 h/);
    assert.match(el.innerHTML, /riskDimToggle/);
    clickOn(el, { level: 3 });
    assert.equal(ds.style('mx').muted, true);
    clickOn(el, { days: 1 });
    assert.equal(ds.style('so').pulse, null, 'last 24 hours only');
    clickOn(el, { dir: 'down' });
    clickOn(el, {});
    assert.equal(changes, 3);
    el.onchange({ target: { id: 'riskDimToggle', checked: true } });
    assert.equal(ds.style('jp').dim, true);
    assert.equal(changes, 4);
  });
  test('the changes mode has no fade switch: it always fades', async () => {
    await create({ view: 'changes' });
    const el = { innerHTML: '' };
    ds.renderSettings(el);
    assert.doesNotMatch(el.innerHTML, /riskDimToggle/);
  });
});

describe('feed', () => {
  test('lists the window\'s changes newest first, of every kind, with their place', () => {
    const f = fakeFeed();
    ds.renderFeed(f.el);
    assert.equal(f.section.hidden, false);
    assert.equal(f.title.textContent, 'Changes in the last 30 days');
    assert.equal(f.count.textContent, 5);
    const names = [...f.el.innerHTML.matchAll(/class="name">([^<]+)</g)].map(m => m[1]);
    assert.deepEqual(names, ['Mexico', 'Mexico', 'Offshore quake', 'Somalia', 'Kenya']);
    assert.match(f.el.innerHTML, /GDACS earthquake: lowered to Orange alert/);
    assert.match(f.el.innerHTML, /5h ago/);
  });
  test('filters by level, direction and the mode\'s category, and says when nothing changed', async () => {
    const f = fakeFeed();
    await create({ view: 'category', category: 'disaster', saved: { direction: 'down' } });
    ds.renderFeed(f.el);
    assert.equal(f.count.textContent, 1);
    await create({ saved: { recentDays: 1, levels: [1, 2] } });
    ds.renderFeed(f.el);
    assert.match(f.el.innerHTML, /No changes in this period\./);
    assert.equal(f.title.textContent, 'Changes in the last 24 hours');
  });
  test('names a change on several places by the first and a count, and caps a long list', async () => {
    const many = Array.from({ length: 55 }, (_, i) => ({ id: `c${i}`, at: hoursAgo(i), kind: 'level', category: 'disaster', placeId: 'mx', from: 1, to: 2, up: true }));
    const wide = { id: 'wide', at: hoursAgo(1), kind: 'event', category: 'disaster', source: 'gdacs', eventId: 'gdacs:DR:3', type: 'drought', placeIds: ['ke', 'so'], to: 2, native: 'Orange', new: true };
    const files = { 'risk/current.json': CURRENT, 'risk/changes.json': { changes: [wide, ...many] }, 'risk/events.json': { events: EVENTS } };
    const settings = createSettings('k', {}, { getItem: () => null, setItem: () => {} });
    const mode = createRiskMode({ i18n: createI18n({ locale: 'en', messages: EN }), settings, client: { file: async (p) => files[p] }, manifest: MANIFEST, places: PLACES, changed() {}, mode: 'changes', view: 'changes', now: () => NOW });
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

  test('a category mode marks its events, the highest mode only major ones, the changes mode none', async () => {
    await withEvents({ view: 'category', category: 'disaster' });
    assert.deepEqual(ds.markers().map(m => m.id), ['gdacs:TC:1', 'gdacs:EQ:2', 'gdacs:DR:3'], 'events without a position are left out');
    assert.deepEqual(ds.markers()[0], { id: 'gdacs:TC:1', lon: 0, lat: 0, kind: 'cyclone', level: 3 });
    await withEvents({ view: 'highest' });
    assert.deepEqual(ds.markers().map(m => m.id), ['gdacs:TC:1', 'gdacs:EQ:2']);
    await withEvents({ view: 'changes' });
    assert.deepEqual(ds.markers(), []);
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

  test('the legend explains markers where there are any', async () => {
    assert.match(ds.legend(), /legend-marker/);
    await create({ view: 'changes' });
    assert.doesNotMatch(ds.legend(), /legend-marker/);
  });
});

describe('country view', () => {
  const container = () => ({ innerHTML: '' });
  const click = (el, attrs) => el.onclick({ target: { closest: (sel) => {
    const m = sel.match(/^\[data-(\w+)(?:="(\w+)")?\]$/);
    if (!m) return null;
    const [, name, value] = m;
    if (!(name in attrs) || (value && attrs[name] !== value)) return null;
    return { dataset: { [name]: String(attrs[name]) } };
  } } });

  test('shows every category, the active alerts, each government in its own words, and the history', async () => {
    const el = container();
    await ds.renderCountryView(el, 'mx', { back() {}, selectEvent() {} });
    assert.deepEqual(requested.at(-1), ['risk/places/mx.json', CURRENT.asOf], 'the place file, versioned');
    const html = el.innerHTML;
    assert.match(html, /<h2 class="cv-name">Mexico<\/h2>/);
    assert.match(html, /High · Disaster/);
    assert.equal((html.match(/<li class="">/g) ?? []).length + (html.match(/<li class="is-focus">/g) ?? []).length, 3, 'three category rows');
    assert.match(html, /Active alerts <span class="count">2<\/span>/);
    assert.match(html, /Orange alert: Tropical Cyclone &lt;b&gt;X&lt;\/b&gt;/);
    assert.match(html, /U\.S\.<\/span>[\s\S]*Level 2 · Exercise increased caution/);
    assert.match(html, /Level 3 · Avoid non-essential travel · under North &lt;America&gt;/, 'a covering advisory says so');
    assert.match(html, /href="https:\/\/travel\.state\.gov\/mx"/);
    assert.match(html, /src="assets\/flags\/gb\.svg"/, 'a flag code that differs from the provider id');
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /data-history="90" aria-checked="true"/);
    assert.match(html, /Disaster: Normal → High/);
    assert.doesNotMatch(html, /Level 1 → 2/, 'the January change is outside 90 days');
    assert.match(html, /not official levels/);
  });

  test('the history window reaches back a year, and is saved', async () => {
    const el = container();
    await ds.renderCountryView(el, 'mx', { back() {}, selectEvent() {} });
    click(el, { history: 365 });
    assert.match(el.innerHTML, /U\.S\.: Level 1 → 2/);
    assert.match(el.innerHTML, /data-history="365" aria-checked="true"/);
    assert.equal(JSON.parse(storage.get('travel-risk-map:settings')).risk.historyDays, 365);
    click(el, { history: 7 });
    assert.doesNotMatch(el.innerHTML, /U\.S\.: Level 1 → 2/);
  });

  const ids = (rows) => rows.map(r => r.placeId);
  const name = (id) => PLACES.get(id).name;
  test('the countries list: each place\'s level, what set it, and its latest level change', () => {
    const rows = countryRows(CURRENT, CHANGES, PLACES.keys());
    assert.deepEqual(rows.find(r => r.placeId === 'mx'), { placeId: 'mx', level: 3, by: ['disaster'], latest: CHANGES[0] });
    assert.deepEqual(rows.find(r => r.placeId === 'ke').by, ['travel', 'disaster']);
    assert.equal(rows.find(r => r.placeId === 'aq').latest, null);
    const disaster = countryRows(CURRENT, CHANGES, PLACES.keys(), { category: 'disaster' });
    assert.deepEqual(disaster.find(r => r.placeId === 'so'), { placeId: 'so', level: 2, by: [], latest: null }, 'a travel change is not a disaster change');
    assert.equal(countryRows(CURRENT, CHANGES, ['aq'], { category: 'travel' })[0].level, null, 'no data');
  });
  test('sorts by level, by latest change, or by name; ties go to the newer change, then the name', () => {
    const rows = countryRows(CURRENT, CHANGES, PLACES.keys());
    assert.deepEqual(ids(sortRows(rows, 'level', name)), ['so', 'mx', 'ke', 'jp', 'aq'], 'Japan changed, Antarctica never');
    assert.deepEqual(ids(sortRows(rows, 'recent', name)), ['mx', 'so', 'ke', 'jp', 'aq']);
    assert.deepEqual(ids(sortRows(rows, 'name', name)), ['aq', 'jp', 'ke', 'mx', 'so']);
    assert.deepEqual(ids(sortRows(rows, 'nope', name)), ['aq', 'jp', 'ke', 'mx', 'so'], 'unknown: by name');
    const noData = countryRows(CURRENT, [], ['aq', 'jp'], { category: 'travel' });
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
    assert.match(el.innerHTML, /Countries · Highest/);
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

  test('back, share and an alert call their handlers', async () => {
    const el = container();
    const calls = [];
    await ds.renderCountryView(el, 'mx', { back: () => calls.push('back'), share: () => calls.push('share'), selectEvent: (id) => calls.push(id) });
    assert.match(el.innerHTML, /<button class="link-btn share" data-action="share"><svg[\s\S]*?<\/svg>Share<\/button>/);
    click(el, { action: 'back' });
    click(el, { action: 'share' });
    click(el, { event: 'gdacs:TC:1' });
    click(el, {});
    assert.deepEqual(calls, ['back', 'share', 'gdacs:TC:1']);
  });

  test('without a place file it falls back to the loaded changes and events', async () => {
    const el = container();
    await ds.renderCountryView(el, 'so', { back() {}, selectEvent() {} });
    assert.match(el.innerHTML, /U\.S\.: Level 3 → 4/);
    assert.match(el.innerHTML, /Active alerts <span class="count">1<\/span>/, 'the drought');
    assert.match(el.innerHTML, /No advisory/, 'no advisories without the file');
    await ds.renderCountryView(el, 'aq', { back() {}, selectEvent() {} });
    assert.match(el.innerHTML, /No active alerts\./);
    assert.match(el.innerHTML, /No changes in this period\./);
  });

  test('an invalid saved history window falls back to 90 days', async () => {
    await create({ saved: { historyDays: 12 } });
    assert.equal(JSON.parse(storage.get('travel-risk-map:settings')).risk.historyDays, 90);
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

  test('the country view shows each series\' week against its normal, a percentage only from 2 expected', async () => {
    await withActivity();
    const el = { innerHTML: '' };
    await ds.renderCountryView(el, 'mx', { back() {}, selectEvent() {} });
    assert.match(el.innerHTML, /News activity/);
    assert.match(el.innerHTML, /18 in the last 7 days, usually about 4 \(\+350%\)/);
    assert.match(el.innerHTML, /12 in the last 7 days, usually about 1\.2</, 'no percentage from an expected 1.2');
    assert.match(el.innerHTML, /far above normal/);
    assert.match(el.innerHTML, /not verified incidents, compared with this country&#39;s own last 12 weeks\. They never set a risk level\./);
  });

  test('while the baseline is being collected, or with no counts, the country view says so', async () => {
    await withActivity({ activity: { gdelt: { ...ACTIVITY.gdelt, learning: true, places: {} } } });
    const el = { innerHTML: '' };
    await ds.renderCountryView(el, 'mx', { back() {}, selectEvent() {} });
    assert.match(el.innerHTML, /Collecting a baseline first/);
    await withActivity({ file: MX_FILE });
    await ds.renderCountryView(el, 'mx', { back() {}, selectEvent() {} });
    assert.match(el.innerHTML, /No news reports of protests or violence counted here\./);
  });

  test('news activity is not listed as a change: not in the feed, Latest changes, tooltip or either history', async () => {
    await withActivity({ file: { ...MX_FILE, changes: [ANOMALY, ...MX_FILE.changes], activity: { source: 'gdelt', series: ACTIVITY.gdelt.places.mx } } });
    const f = fakeFeed();
    ds.renderFeed(f.el);
    assert.equal(f.count.textContent, 5, 'the five changes, not the anomaly');
    assert.doesNotMatch(f.el.innerHTML, /mx:protest|GDELT/);
    assert.equal(ds.feedTarget('mx:protest:2026-09-27'), null, 'not a feed item');
    assert.doesNotMatch(ds.details(null), /Protest reports/, 'not in the latest changes');
    assert.doesNotMatch(ds.tooltip('mx'), /Protest reports/);
    assert.doesNotMatch(ds.details({ placeId: 'mx' }).split('Recent changes')[1], /Protest reports/, 'not in the card history');
    const el = { innerHTML: '' };
    await ds.renderCountryView(el, 'mx', { back() {}, selectEvent() {} });
    assert.match(el.innerHTML, /cv-history/);
    assert.doesNotMatch(el.innerHTML.split('cv-history')[1], /Protest reports/, 'not in the country history');
    assert.match(el.innerHTML, /far above normal/, 'shown as it is now, in the country view\'s news section');
  });

  test('in the Changes mode, news activity alone is not a change: the place stays faded', async () => {
    const files = { 'risk/current.json': CURRENT, 'risk/changes.json': { changes: [{ ...ANOMALY, id: 'jp:protest', placeId: 'jp' }, ...CHANGES] }, 'risk/events.json': { events: EVENTS } };
    const settings = createSettings('k3', {}, { getItem: () => null, setItem: () => {} });
    const mode = createRiskMode({ i18n: createI18n({ locale: 'en', messages: EN }), settings, client: { file: async (p) => files[p] }, manifest: MANIFEST, places: PLACES, changed() {}, mode: 'changes', view: 'changes', now: () => NOW });
    await mode.load();
    assert.equal(mode.style('jp').dim, true, 'only news activity in the window');
    assert.equal(mode.style('mx').dim, false, 'a level change');
  });

  // Seven places: far before above, then by how far above normal, then by name; "normal" isn't listed.
  const MANY = { gdelt: { ...ACTIVITY.gdelt, places: {
    mx: { protest: { status: 'above', count: 30, expected: 10 } },
    jp: { violence: { status: 'far', count: 40, expected: 4 } },
    so: { protest: { status: 'far', count: 90, expected: 3 } },
    ke: { protest: { status: 'above', count: 12, expected: 2 } },
    aq: { protest: { status: 'above', count: 6, expected: 2 } },
    il: { protest: { status: 'above', count: 5, expected: 0.5 } },
    zz: { violence: { status: 'normal', count: 5, expected: 5 } },
  } } };
  test('newsRows: most unusual first, each place\'s series, "normal" left out', () => {
    const rows = newsRows(MANY, (id) => PLACES.get(id)?.name ?? id);
    assert.deepEqual(rows.map(r => [r.placeId, r.status, r.ratio]), [['so', 'far', 30], ['jp', 'far', 10], ['ke', 'above', 6], ['il', 'above', 5], ['aq', 'above', 3], ['mx', 'above', 3]]);
    assert.deepEqual(newsRows(ACTIVITY, (id) => id)[0].items.map(i => i.series), ['protest', 'violence'], 'far before above');
    assert.deepEqual(newsRows(undefined, (id) => id), []);
  });

  const fakeNews = () => {
    const count = { textContent: '' };
    const section = { hidden: true, querySelector: () => count };
    return { el: { innerHTML: '', closest: () => section }, section, count };
  };
  test('the news section lists the unusual activity now, most unusual first, 5 until "Show all"', async () => {
    await withActivity({ activity: MANY });
    const n = fakeNews();
    ds.renderNews(n.el);
    assert.equal(n.section.hidden, false);
    assert.equal(n.count.textContent, 6);
    assert.deepEqual([...n.el.innerHTML.matchAll(/data-place="(\w+)"/g)].map(m => m[1]), ['so', 'jp', 'ke', 'il', 'aq']);
    assert.match(n.el.innerHTML, /<li class="far"><button data-place="so" title="Protest reports far above normal \(GDELT\)">/);
    assert.match(n.el.innerHTML, /class="name">Somalia<[\s\S]*?class="what">Protest reports far above normal</);
    assert.match(n.el.innerHTML, /data-news-all>Show all 6</);
    n.el.onclick({ target: { closest: () => null } });
    assert.equal((n.el.innerHTML.match(/data-place=/g) ?? []).length, 5, 'another click changes nothing');
    n.el.onclick({ target: { closest: (sel) => (sel === '[data-news-all]' ? {} : null) } });
    assert.equal((n.el.innerHTML.match(/data-place=/g) ?? []).length, 6);
    assert.doesNotMatch(n.el.innerHTML, /data-news-all/);
  });
  test('the news section is hidden in a category mode and without unusual activity', async () => {
    await withActivity({ activity: { gdelt: { ...ACTIVITY.gdelt, places: {} } } });
    const n = fakeNews();
    n.section.hidden = false;
    ds.renderNews(n.el);
    assert.equal(n.section.hidden, true, 'nothing unusual');
    const files = { 'risk/current.json': { ...CURRENT, activity: MANY }, 'risk/changes.json': { changes: CHANGES }, 'risk/events.json': { events: EVENTS } };
    const settings = createSettings('k4', {}, { getItem: () => null, setItem: () => {} });
    const mode = createRiskMode({ i18n: createI18n({ locale: 'en', messages: EN }), settings, client: { file: async (p) => files[p] }, manifest: MANIFEST, places: PLACES, changed() {}, mode: 'disaster', view: 'category', category: 'disaster', now: () => NOW });
    await mode.load();
    n.section.hidden = false;
    mode.renderNews(n.el);
    assert.equal(n.section.hidden, true, 'a category mode');
  });
});
