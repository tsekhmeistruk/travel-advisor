// The risk modes (views and rules) with small fake risk files, real English messages, a fixed
// clock and in-memory settings. No browser needed.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRiskMode, WINDOWS } from '../../../site/js/datasets/risk/index.js';
import {
  changeTime, ageHours, changePlaces, direction, levelOf, highest, filterChanges, changesFor, pulseOpacity, countByLevel,
  countDirections, cardModel,
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
    disaster: { sources: ['gdacs'], default: 1, status: 'healthy', at: hoursAgo(2) },
    wildfire: { sources: ['gdacs'], default: 1, status: 'healthy', at: hoursAgo(2) },
  },
  sources: { gdacs: { url: 'https://www.gdacs.org/' }, us: { url: 'javascript:alert(1)' } },
  places: {
    mx: { travel: { level: 2, natives: { us: 2, ca: 2 }, agree: 2 }, disaster: { level: 3, since: hoursAgo(5), from: 1, basis: ['gdacs:TC:1', 'gdacs:EQ:2'] } },
    jp: { travel: { level: 1, natives: { us: 1, ca: 1 }, agree: 2 } },
    so: { travel: { level: 4, natives: { us: 4, ca: 3 }, agree: 1 }, disaster: { level: 2, basis: ['gdacs:DR:3'] } },
    ke: { travel: { level: 2, natives: { us: 2 }, agree: 1 }, disaster: { level: 2, basis: ['gdacs:DR:3'] } },
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
const MANIFEST = { asOf: CURRENT.asOf, current: 'risk/current.json', changes: 'risk/changes.json', events: 'risk/events.json', places: 'risk/places/' };
// A place file as the build writes it: advisories, active event ids, a year of changes.
const MX_FILE = {
  placeId: 'mx',
  advisories: {
    us: { level: 2, title: 'Mexico', updated: '2026-05-29', url: 'https://travel.state.gov/mx', own: true },
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
  const files = { 'risk/current.json': current, 'risk/changes.json': { changes: CHANGES }, 'risk/events.json': { events: EVENTS }, 'risk/places/mx.json': MX_FILE };
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
    assert.deepEqual(m.rows.map(r => [r.category, r.level, r.changed]), [['travel', 2, null], ['disaster', 3, 'up'], ['wildfire', 1, null]]);
    assert.deepEqual(m.rows[0].basis, { travel: { agree: 2, count: 2 } });
    assert.deepEqual(m.rows[1].basis.events.map(e => e.id), ['gdacs:TC:1', 'gdacs:EQ:2']);
    assert.equal(m.rows[2].basis, null);
    assert.equal(m.trend, 'up');
    assert.equal(m.history.length, 2);
    assert.equal(m.link, 'https://www.gdacs.org/report.aspx?eventid=1');
    const aq = cardModel('aq', { current: CURRENT, changes: CHANGES, events: EVENTS, now: NOW, windowDays: 30 });
    assert.deepEqual([aq.rows[0].basis, aq.trend, aq.link, aq.history], [null, null, null, []]);
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
    assert.equal(formatHash({ mode: 'highest', view: 'country' }), '#mode=highest', 'a view needs a place');
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
  test('loads the three risk files, versioned by their as-of time, and has no providers', () => {
    assert.deepEqual(requested, [['risk/current.json', CURRENT.asOf], ['risk/changes.json', CURRENT.asOf], ['risk/events.json', CURRENT.asOf]]);
    assert.deepEqual(ds.providers(), []);
    assert.equal(ds.provider(), null);
    assert.equal(ds.providerSwitchLabel(), '');
    assert.equal(ds.id, 'highest');
  });
});

describe('map style', () => {
  test('highest: colours by the highest level, pulses only level changes, dots only above Normal', () => {
    assert.deepEqual(ds.style('mx'), { cls: 'l3', muted: false, dim: false, dot: true, pulse: ds.style('mx').pulse });
    assert.ok(ds.style('mx').pulse > 0);
    assert.ok(ds.style('so').pulse > 0, 'an advisory level change pulses');
    assert.equal(ds.style('jp').pulse, null, 'too old for the 30-day window');
    assert.deepEqual(ds.style('jp'), { cls: 'l1', muted: false, dim: false, dot: false, pulse: null });
    assert.deepEqual(ds.style('aq'), { cls: 'l1', muted: false, dim: false, dot: false, pulse: null }, 'disaster covers it: Normal');
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
    assert.match(html, /Wildfire<\/span>\s*<span class="lvl">Normal/);
    assert.match(html, /Disaster: Normal → High/);
    assert.match(html, /New GDACS Orange alert: tropical cyclone/);
    assert.match(html, /href="https:\/\/www\.gdacs\.org\/report\.aspx\?eventid=1"/);
    assert.match(html, /Security and unrest: coming later/);
    assert.match(html, /<button class="link link-btn" data-action="country" data-place="mx">Country details →<\/button>/);
  });
  test('a place with no data says so, and without changes says that', () => {
    const html = ds.details({ placeId: 'aq' });
    assert.match(html, /No advisory/);
    assert.match(html, /No changes in the last 90 days\./);
    assert.doesNotMatch(html, /report ↗/);
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
  test('an unavailable source is named on the row; unsafe links are dropped', async () => {
    await create({ current: { ...CURRENT, categories: { ...CURRENT.categories, wildfire: { sources: ['gdacs'], default: null, status: 'error' } } } });
    assert.match(ds.details({ placeId: 'jp' }), /Wildfire<\/span>\s*<span class="lvl">No data[\s\S]*Source unavailable/);
    assert.doesNotMatch(ds.footer(), /javascript:/);
  });
});

describe('texts', () => {
  test('header: the data age, and a source that is not healthy', async () => {
    assert.equal(ds.header(), 'Risk Monitor · updated 2 hours ago');
    await create({ current: { ...CURRENT, categories: { ...CURRENT.categories, disaster: { ...CURRENT.categories.disaster, status: 'delayed' } } } });
    assert.equal(ds.header(), 'Risk Monitor · updated 2 hours ago · GDACS delayed');
    await create({ view: 'category', category: 'wildfire', current: { ...CURRENT, categories: { ...CURRENT.categories, disaster: { ...CURRENT.categories.disaster, status: 'error' } } } });
    assert.equal(ds.header(), 'Risk Monitor · updated 2 hours ago', 'only this mode\'s categories count');
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
  test('search lists every place with its level', () => {
    const entries = ds.searchEntries();
    assert.equal(entries.length, PLACES.size);
    assert.deepEqual(entries.find(e => e.target.placeId === 'mx'), { label: 'Mexico', aliases: ['Mexico'], swatch: 'var(--l3)', sub: 'High', target: { placeId: 'mx' } });
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
    assert.equal((f.el.innerHTML.match(/<button/g) ?? []).length, 50);
    assert.match(f.el.innerHTML, /and 6 more/);
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

  test('back and an alert call their handlers', async () => {
    const el = container();
    const calls = [];
    await ds.renderCountryView(el, 'mx', { back: () => calls.push('back'), selectEvent: (id) => calls.push(id) });
    click(el, { action: 'back' });
    click(el, { event: 'gdacs:TC:1' });
    click(el, {});
    assert.deepEqual(calls, ['back', 'gdacs:TC:1']);
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
