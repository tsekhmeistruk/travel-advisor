// The Wars mode: its pure rules (logic.js) and its cards, list, map focus, dots, legend and header,
// with small conflict, wars and dots files shaped like the build publishes them (lib/conflict.mjs,
// lib/wars.mjs), real English messages and a fixed clock.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWarsMode } from '../../../site/js/datasets/wars/index.js';
import {
  windowMonths, bandRows, conflictTitle, conflictName, overviewModel, placeModel, sparkPoints, barRects, conflictUrl, tensionRows,
  warTitle, sideActors, firstNames, warRows, newRows, quietRows, warModel, warFocus, dotRadius, countryDots,
} from '../../../site/js/datasets/wars/logic.js';
import { createI18n } from '../../../site/js/core/i18n.js';
import { createSettings } from '../../../site/js/core/settings.js';

const EN = JSON.parse(readFileSync(new URL('../../../site/i18n/en.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-02T12:00:00Z');
const PLACES = new Map([
  ['ua', { id: 'ua', name: 'Ukraine', iso2: 'UA' }], ['ru', { id: 'ru', name: 'Russia', iso2: 'RU' }],
  ['mx', { id: 'mx', name: 'Mexico', iso2: 'MX' }], ['ye', { id: 'ye', name: 'Yemen', iso2: 'YE' }],
  ['lb', { id: 'lb', name: 'Lebanon', iso2: 'LB' }], ['ng', { id: 'ng', name: 'Nigeria', iso2: 'NG' }],
  ['fr', { id: 'fr', name: 'France', iso2: 'FR' }], ['af', { id: 'af', name: 'Afghanistan', iso2: 'AF' }], ['pk', { id: 'pk', name: 'Pakistan', iso2: 'PK' }],
  ['gb', { id: 'gb', name: 'United Kingdom', iso2: 'GB' }], ['ir', { id: 'ir', name: 'Iran', iso2: 'IR' }], ['il', { id: 'il', name: 'Israel', iso2: 'IL' }],
  ['ae', { id: 'ae', name: 'United Arab Emirates', iso2: 'AE' }], ['gaza', { id: 'gaza', name: 'Gaza' }], ['west-bank', { id: 'west-bank', name: 'West Bank' }],
  ['by', { id: 'by', name: 'Belarus', iso2: 'BY' }], ['kp', { id: 'kp', name: 'North Korea', iso2: 'KP' }], ['sd', { id: 'sd', name: 'Sudan', iso2: 'SD' }],
  ['eg', { id: 'eg', name: 'Egypt', iso2: 'EG' }], ['sy', { id: 'sy', name: 'Syria', iso2: 'SY' }], ['tr', { id: 'tr', name: 'Turkey', iso2: 'TR' }],
  ['cn', { id: 'cn', name: 'China', iso2: 'CN' }], ['us', { id: 'us', name: 'United States', iso2: 'US' }],
]);
const twelve = (last, before = 0) => [before, before, before, before, before, before, before, before, before, ...last];
const CONFLICT = {
  asOf: '2026-09-20T06:00:00.000Z', source: 'ucdp', version: '26.0.8', through: '2026-08', preliminary: true,
  links: { home: 'https://ucdp.uu.se/', conflict: 'https://ucdp.uu.se/conflict/' },
  windowMonths: 12, bands: [1000, 100, 25], warDeaths: 1000,
  series: {
    months: ['2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
    wars: [null, null, 12, 13, 13, 13, 12, 13, 14, 14, 14, 14, 15, 15, 16],
    armedConflicts: [null, null, 70, 72, 73, 71, 73, 73, 74, 76, 78, 76, 74, 77, 72],
    deaths: [9000, 9500, 10000, 11000, 12000, 13000, 12000, 39181, 14873, 16210, 11804, 11959, 9084, 9467, 11118],
  },
  // As lib/conflict.mjs publishes them: most deaths first, each with its sides from the events.
  conflicts: {
    '1:13243': { name: 'Russia - Ukraine', deaths12: 97739, last: 5702, war: true, places: ['ua', 'ru'], parties: ['ru', 'ua'], first: '2024-01', trend: null, civilians12: 2500,
      sides: { a: [{ name: 'Government of Russia (Soviet Union)', place: 'ru', deaths: 97739 }], b: [{ name: 'Government of Ukraine', place: 'ua', deaths: 97739 }] },
      months: [9300, 10300, 10400, 10100, 13400, 7400, 7800, 6900, 6700, 4700, 4900, 5839] },
    '1:309': { name: 'Sudan: Government', deaths12: 5099, last: 204, war: true, places: ['sd'], parties: ['sd'], first: '2024-01', trend: 'down', civilians12: 2232,
      sides: { a: [{ name: 'Government of Sudan', place: 'sd', deaths: 5099 }], b: [{ name: 'SFA', deaths: 4813 }, { name: 'RSF', deaths: 286 }] },
      months: twelve([300, 250, 204], 483) },
    '1:119': { name: null, deaths12: 2595, last: 450, war: true, places: ['ng'], parties: ['ng'], first: '2024-01', trend: null, civilians12: 0,
      sides: { a: [{ name: null, place: 'ng', deaths: 2200 }, { name: 'Government of Nigeria', place: 'ng', deaths: 395 }], b: [{ name: null, deaths: 2200 }, { name: 'Forces of Bello Turji', deaths: 300 }] },
      months: twelve([300, 300, 450], 172) },
    '1:777': { name: 'Yemen (North Yemen): Government', deaths12: 1871, last: 1380, war: true, places: ['ye'], parties: ['ye'], first: '2026-06', trend: 'up', civilians12: 40,
      sides: { a: [{ name: 'Government of Yemen (North Yemen)', place: 'ye', deaths: 1871 }], b: [{ name: 'AQAP', deaths: 1871 }] },
      months: twelve([220, 1380, 50], 25) },
    '1:12': { name: null, deaths12: 51, last: 3, war: false, places: ['mx'], parties: [], first: '2024-01', trend: null, civilians12: 0,
      sides: { a: [{ name: null, deaths: 51 }], b: [{ name: null, deaths: 51 }] }, months: twelve([3, 3, 3], 5) },
  },
  new: ['1:777'],
  quiet: [{ key: '1:299', name: 'Syria: Government', deaths: 2238, lastDeaths: '2025-07', parties: ['sy'] }],
  places: {
    ua: { deaths12: 97381, months: [9298, 10281, 10350, 10117, 13372, 7436, 7772, 6857, 6656, 4725, 4869, 5648], byType: { state: 97336, nonState: 0, oneSided: 45 }, trend: null, conflicts: ['1:13243'], partyTo: ['1:13243'] },
    ru: { deaths12: 448, months: [79, 43, 46, 55, 8, 2, 20, 36, 49, 34, 22, 54], byType: { state: 446, nonState: 0, oneSided: 2 }, trend: null, conflicts: ['1:13243'], partyTo: ['1:13243'] },
    ye: { deaths12: 1871, months: twelve([220, 1380, 50], 25), byType: { state: 1871, nonState: 0, oneSided: 0 }, trend: 'up', conflicts: ['1:777'], partyTo: ['1:777'] },
    lb: { deaths12: 2767, months: [23, 32, 41, 15, 22, 27, 1340, 577, 349, 295, 21, 25], byType: { state: 2767, nonState: 0, oneSided: 0 }, trend: 'down', conflicts: [], partyTo: [] },
    ng: { deaths12: 2700, months: twelve([300, 300, 300], 200), byType: { state: 2600, nonState: 50, oneSided: 50 }, trend: null, conflicts: ['1:119'], partyTo: ['1:119'] },
    sd: { deaths12: 9940, months: twelve([300, 250, 204], 1000), byType: { state: 5099, nonState: 241, oneSided: 4600 }, trend: 'down', conflicts: ['1:309'], partyTo: ['1:309'] },
    mx: { deaths12: 2826, months: twelve([200, 200, 214], 245), byType: { state: 51, nonState: 2583, oneSided: 192 }, trend: null, conflicts: ['1:12'], partyTo: [] },
  },
};
const CURRENT = {
  asOf: '2026-10-02T10:00:00.000Z',
  categories: { travel: { sources: ['us'], default: null }, conflict: { sources: ['ucdp'], default: 1, status: 'healthy', at: CONFLICT.asOf } },
  sources: { ucdp: { url: 'https://ucdp.uu.se/' } },
  places: Object.fromEntries(Object.entries(CONFLICT.places).map(([id, p]) => [id, { conflict: { level: CONFLICT.bands.findIndex(b => p.deaths12 >= b) === -1 ? 1 : 4 - CONFLICT.bands.findIndex(b => p.deaths12 >= b), basis: ['ucdp:2026-08'] } }])),
};
// Tensions as the build publishes them (current.activity.gdelt.tensions): above normal only.
const TENSIONS = { through: '2026-10-01', learning: false, windowDays: 7, baselineDays: 84, pairs: {
  'ARE|ISR': { status: 'far', count: 58, expected: 4.1, sides: [['ae'], ['il']] },
  'AFG|PAK': { status: 'above', count: 209, expected: 56.9, sides: [['af'], ['pk']] },
  'GBR|IRN': { status: 'above', count: 102, expected: 22.1, sides: [['gb'], ['ir']] },
  'ISR|PSE': { status: 'above', count: 90, expected: 20, sides: [['il'], ['gaza', 'west-bank']] },
} };
// The context of the wars (lib/wars.mjs): Ukraine and Sudan from Wikipedia, Syria gone quiet.
const WARS = { asOf: '2026-10-02T12:00:00.000Z', source: 'wikipedia', licence: 'CC BY-SA 4.0', conflicts: {
  '1:13243': { title: 'Russo-Ukrainian war (2022–present)', url: 'https://en.wikipedia.org/wiki/Russo-Ukrainian_war_(2022%E2%80%93present)', extract: 'On 24 February 2022, Russia invaded Ukraine.', start: '2022-02',
    map: 'https://en.wikipedia.org/wiki/File:2022_Russian_invasion_of_Ukraine.svg', sides: { a: { with: ['by', 'kp'], backers: [] }, b: { with: [], backers: [] } }, names: {} },
  '1:309': { title: 'Sudanese civil war (2023–present)', url: 'https://en.wikipedia.org/wiki/Sudanese_civil_war_(2023%E2%80%93present)', extract: 'A civil war between the Sudanese Armed Forces and the Rapid Support Forces.', start: '2023-04', map: null,
    sides: { a: { with: ['eg'], backers: ['tr', 'cn', 'us', 'ae'] }, b: { with: [], backers: [] } }, names: { SFA: 'Sudan Founding Alliance', RSF: 'Rapid Support Forces' } },
  '1:299': { title: 'Syrian civil war', url: 'https://en.wikipedia.org/wiki/Syrian_civil_war', extract: 'The Syrian civil war was fought from 2011 to 2024.', start: '2011-03', map: null, sides: null, names: {} },
} };
// The month's dots (lib/conflict.mjs): [lat, lon, deaths, date, key, side A, side B, place, region].
const DOTS = { through: '2026-08', actors: { 57: 'Government of Russia (Soviet Union)', 61: 'Government of Ukraine', 3714: 'XXX475', 8635: 'RSF', 112: 'Government of Sudan', 9: 'Sinaloa Cartel' },
  conflicts: { '1:13243': 'Russia - Ukraine', '1:309': 'Sudan: Government', '2:70': 'XXX70 - XXX70' },
  events: [[48.0, 37.8, 120, '2026-08-03', '1:13243', 57, 61, 'ua', 'Donetsk oblast'], [13.63, 25.35, 27, '2026-08-01', '1:309', 112, 8635, 'sd', 'North Darfur state'], [24.8, -107.4, 3, '2026-08-05', '2:70', 9, 3714, 'mx', 'Sinaloa state']] };
const MANIFEST = { asOf: CURRENT.asOf, current: 'risk/current.json', changes: 'risk/changes.json', events: 'risk/events.json', conflict: 'risk/conflict.json', conflictEvents: 'risk/conflict-events.json', wars: 'risk/wars.json', places: 'risk/places/' };

let ds;
async function create({ current = CURRENT, conflict = CONFLICT, wars = WARS, dots = DOTS } = {}) {
  const storage = new Map();
  const settings = createSettings('travel-risk-map:settings', {}, { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) });
  const files = { 'risk/current.json': current, 'risk/changes.json': { changes: [] }, 'risk/events.json': { events: [] }, 'risk/conflict.json': conflict };
  if (wars) files['risk/wars.json'] = wars;
  if (dots) files['risk/conflict-events.json'] = dots;
  ds = createWarsMode({
    i18n: createI18n({ locale: 'en', messages: EN, today: new Date(NOW) }), settings, places: PLACES, manifest: MANIFEST,
    client: { file: async (p) => { if (!files[p]) throw new Error('HTTP 404'); return files[p]; } }, changed() {}, now: () => NOW,
  });
  await ds.load();
  return ds;
}
beforeEach(() => create());

describe('logic', () => {
  test('the 12 months of the figures, across a year', () => {
    assert.deepEqual(windowMonths('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
    assert.equal(windowMonths('2026-08').length, 12);
    assert.equal(windowMonths('2026-08')[0], '2025-09');
  });
  test('the legend bands, from the highest; Normal is fewer than the lowest band', () => {
    assert.deepEqual(bandRows([1000, 100, 25]), [{ level: 4, min: 1000, max: null }, { level: 3, min: 100, max: 999 }, { level: 2, min: 25, max: 99 }, { level: 1, min: 0, max: 24 }]);
  });
  test('conflict names: UCDP\'s without the old names in brackets; the government, or where, when unnamed', () => {
    assert.equal(conflictTitle(CONFLICT.conflicts['1:777']), 'Yemen: Government');
    assert.equal(conflictTitle(CONFLICT.conflicts['1:13243']), 'Russia – Ukraine');
    assert.equal(conflictTitle(CONFLICT.conflicts['1:119']), null);
    assert.equal(conflictTitle(CONFLICT.conflicts['1:309']), 'Sudan: Government');
    const t = (key, p) => `${key}:${p.place}`;
    const name = (id) => PLACES.get(id).name;
    assert.equal(conflictName(CONFLICT.conflicts['1:119'], t, name), 'unnamed:Nigeria');
    assert.equal(conflictName(CONFLICT.conflicts['1:12'], t, name), 'unnamedNoParty:Mexico');
  });
  test('the overview: wars now and a year ago, the sparkline from the first full window, deaths, trends', () => {
    const m = overviewModel(CONFLICT);
    assert.deepEqual([m.wars, m.armed, m.yearAgo, m.through], [16, 72, 12, '2026-08']);
    assert.deepEqual(m.spark[0], { month: '2025-08', wars: 12 });
    assert.equal(m.spark.length, 13);
    assert.deepEqual(m.deaths, { month: '2026-08', count: 11118, previous: 9467 });
    assert.deepEqual([m.escalating, m.calming], [['ye'], ['sd', 'lb']], 'calming: most deaths before first');
    assert.deepEqual(overviewModel({ ...CONFLICT, places: { ...CONFLICT.places, ng: { ...CONFLICT.places.ng, trend: 'up' } } }).escalating, ['ye', 'ng'], 'most deaths in the last 3 months first');
    assert.deepEqual(overviewModel(CONFLICT, { max: 1 }).calming, ['sd']);
    assert.deepEqual(overviewModel(CONFLICT, { max: 0 }).escalating, []);
  });
  test('a place: months, trend figures, conflicts fought there and elsewhere; null when nothing recorded', () => {
    const ye = placeModel(CONFLICT, 'ye');
    assert.deepEqual([ye.deaths12, ye.last3, ye.prev3, ye.trend], [1871, 1650, 75, 'up']);
    assert.deepEqual(ye.months[0], { month: '2025-09', deaths: 25 });
    assert.equal(ye.fought[0].key, '1:777');
    assert.deepEqual(placeModel(CONFLICT, 'lb').fought, []);
    assert.deepEqual(placeModel({ ...CONFLICT, places: { ...CONFLICT.places, ru: { ...CONFLICT.places.ru, conflicts: [] } } }, 'ru').elsewhere.map(c => c.key), ['1:13243'], 'a party to a war fought elsewhere');
    assert.equal(placeModel(CONFLICT, 'fr'), null);
  });
  test('tensions: the biggest surge first (reports above the expected count), at most max', () => {
    assert.deepEqual(tensionRows(TENSIONS).map(t => t.key), ['AFG|PAK', 'GBR|IRN', 'ISR|PSE', 'ARE|ISR']);
    assert.deepEqual(tensionRows(TENSIONS, 2).map(t => t.key), ['AFG|PAK', 'GBR|IRN']);
    assert.deepEqual(tensionRows(undefined), []);
    assert.deepEqual(tensionRows(TENSIONS)[2].sides, [['il'], ['gaza', 'west-bank']]);
  });
  test('the sparkline and bars fit their box', () => {
    assert.equal(sparkPoints([12, 16, 14], 100, 30, 2), '2,28 50,2 98,15');
    assert.equal(sparkPoints([5, 5], 100, 30), '2,15 98,15', 'flat: the middle');
    assert.equal(sparkPoints([7], 100, 30), '50,15');
    assert.equal(sparkPoints([], 100, 30), '');
    assert.deepEqual(barRects([0, 5, 10], 32, 20, 1), [{ x: 0, y: 20, w: 10, h: 0 }, { x: 11, y: 10, w: 10, h: 10 }, { x: 22, y: 0, w: 10, h: 20 }]);
    assert.equal(barRects([1, 10000], 20, 40)[0].h, 1, 'a small month still shows');
    assert.equal(conflictUrl('https://ucdp.uu.se/conflict/', '1:13243'), 'https://ucdp.uu.se/conflict/13243');
  });
});

describe('logic: who fights whom', () => {
  const opts = { placeName: (id) => PLACES.get(id)?.name ?? id, unnamed: 'unidentified' };
  test('a war\'s title: Wikipedia\'s without the years, else UCDP\'s, else none', () => {
    assert.equal(warTitle(CONFLICT.conflicts['1:13243'], WARS.conflicts['1:13243']), 'Russo-Ukrainian war');
    assert.equal(warTitle(CONFLICT.conflicts['1:777'], null), 'Yemen: Government');
    assert.equal(warTitle(CONFLICT.conflicts['1:119'], undefined), null);
    assert.equal(warTitle({ name: 'Syria: Government' }, WARS.conflicts['1:299']), 'Syrian civil war');
  });
  test('a side\'s actors: a government by its place, a group by its full name when Wikipedia spells it out, an unidentified one only alone', () => {
    const sudan = CONFLICT.conflicts['1:309'].sides;
    assert.deepEqual(sideActors(sudan.a, opts), [{ text: 'Sudan', short: 'Sudan', place: 'sd' }]);
    assert.deepEqual(sideActors(sudan.b, { ...opts, names: WARS.conflicts['1:309'].names }), [
      { text: 'Sudan Founding Alliance', short: 'SFA' }, { text: 'Rapid Support Forces', short: 'RSF' }]);
    const nigeria = CONFLICT.conflicts['1:119'].sides;
    assert.deepEqual(sideActors(nigeria.a, opts), [{ text: 'Nigeria', short: 'Nigeria', place: 'ng' }], 'the government once (XXX475 is it, on side A)');
    assert.deepEqual(sideActors(nigeria.b, opts).map(x => x.short), ['Forces of Bello Turji'], 'the named group; the unidentified ones are left out');
    assert.deepEqual(sideActors(CONFLICT.conflicts['1:12'].sides.b, opts), [{ text: 'unidentified', short: 'unidentified', unnamed: true }]);
    assert.deepEqual(firstNames(['a', 'b', 'c'], 2), { names: ['a', 'b'], more: 1 });
    assert.deepEqual(firstNames(['a'], 2), { names: ['a'], more: 0 });
  });
  test('the Wars list: every listed conflict as published, with both sides; new ones; those gone quiet', () => {
    const rows = warRows(CONFLICT, WARS, opts);
    assert.deepEqual(rows.map(r => r.key), ['1:13243', '1:309', '1:119', '1:777', '1:12']);
    assert.deepEqual(rows[1], { key: '1:309', war: true, deaths12: 5099, last: 204, trend: 'down', title: 'Sudanese civil war',
      a: [{ text: 'Sudan', short: 'Sudan', place: 'sd' }], b: [{ text: 'Sudan Founding Alliance', short: 'SFA' }, { text: 'Rapid Support Forces', short: 'RSF' }] });
    assert.equal(warRows(CONFLICT, null, opts)[1].title, 'Sudan: Government', 'without Wikipedia');
    assert.deepEqual(newRows(CONFLICT), ['1:777']);
    assert.deepEqual(newRows({ ...CONFLICT, new: ['1:777', '1:999', '1:309'] }), ['1:309', '1:777'], 'most deaths first; unknown keys left out');
    assert.deepEqual(quietRows(CONFLICT, WARS), [{ key: '1:299', name: 'Syria: Government', deaths: 2238, lastDeaths: '2025-07', parties: ['sy'], title: 'Syrian civil war' }]);
    assert.deepEqual(quietRows({ ...CONFLICT, quiet: undefined }, WARS), []);
  });
  test('a war\'s card: its sides with Wikipedia\'s countries, its months, its context; gone quiet; unknown', () => {
    const m = warModel(CONFLICT, WARS, '1:13243', opts);
    assert.deepEqual([m.title, m.war, m.start, m.first, m.deaths12, m.last, m.civilians12, m.trend], ['Russo-Ukrainian war', true, '2022-02', '2024-01', 97739, 5702, 2500, null]);
    assert.deepEqual(m.sides.a, { actors: [{ text: 'Russia', short: 'Russia', place: 'ru' }], with: ['by', 'kp'], backers: [] });
    assert.deepEqual(m.months.at(-1), { month: '2026-08', deaths: 5839 });
    assert.equal(m.extract, 'On 24 February 2022, Russia invaded Ukraine.');
    assert.equal(m.map, 'https://en.wikipedia.org/wiki/File:2022_Russian_invasion_of_Ukraine.svg');
    const bare = warModel(CONFLICT, null, '1:777', opts);
    assert.deepEqual([bare.title, bare.extract, bare.url, bare.sides.b.with], ['Yemen: Government', null, null, []]);
    const quiet = warModel(CONFLICT, WARS, '1:299', opts);
    assert.deepEqual([quiet.title, quiet.sides, quiet.months, quiet.parties, quiet.quiet.lastDeaths], ['Syrian civil war', null, [], ['sy'], '2025-07']);
    assert.equal(warModel(CONFLICT, WARS, '1:999', opts), null);
  });
  test('the map\'s focus: each side\'s places, the allies, where it is fought; gone quiet, its parties', () => {
    const f = warFocus(warModel(CONFLICT, WARS, '1:13243', opts));
    assert.deepEqual([[...f.a], [...f.b], [...f.allyA], [...f.allyB], [...f.fought]], [['ru'], ['ua'], ['by', 'kp'], [], []], 'both places are sides');
    const sudan = warFocus(warModel(CONFLICT, WARS, '1:309', opts));
    assert.deepEqual([[...sudan.a], [...sudan.b], [...sudan.allyA], [...sudan.fought]], [['sd'], [], ['eg'], []]);
    const syria = warFocus(warModel(CONFLICT, WARS, '1:299', opts));
    assert.deepEqual([[...syria.a], [...syria.fought]], [[], ['sy']]);
    assert.equal(syria.key, '1:299');
  });
  test('dots grow with the square root of the deaths, up to 11px', () => {
    assert.deepEqual([1, 4, 100, 5017].map(dotRadius), [2.1, 2.5, 6.1, 11]);
  });
  test('the month\'s events, one dot per country: its deaths and events, its conflicts by deaths; none at sea', () => {
    const ev = (deaths, key, place) => [0, 0, deaths, '2026-08-01', key, 1, 2, place, ''];
    assert.deepEqual(countryDots([ev(5, '1:1', 'ua'), ev(30, '1:2', 'sd'), ev(7, '1:1', 'ua'), ev(9, '3:4', 'ua'), ev(50, '1:1', null)]), [
      { place: 'sd', deaths: 30, events: 1, keys: [['1:2', 30]] },
      { place: 'ua', deaths: 21, events: 3, keys: [['1:1', 12], ['3:4', 9]] },
    ]);
    assert.deepEqual(countryDots(undefined), []);
  });
});

describe('the mode', () => {
  test('the overview: the war count, the month\'s deaths, escalating and calming as buttons to their place', () => {
    const html = ds.details(null);
    assert.match(html, /Wars now · UCDP, to August 2026/);
    assert.match(html, /<b>16<\/b><span>wars<\/span>/);
    assert.match(html, /12 in August 2025/);
    assert.match(html, /<div class="wars-count" title="And 56 smaller armed conflicts\. A war: 1,000\+ deaths in 12 months, a government on one side\.">/, 'in the count\'s title');
    assert.doesNotMatch(html, /wars-sub/);
    assert.match(html, /New in 12 months<\/div><div class="wars-chips"><button data-war="1:777" title="Yemen: Government">Yemen vs AQAP<\/button>/);
    assert.match(html, /Deaths in August 2026: 11,118 <span class="arrow up"[^>]*>▲<\/span> <span class="dim">from 9,467<\/span>/);
    assert.match(html, /Escalating<\/div><div class="wars-chips"><button data-place="ye">Yemen<span class="arrow up"/);
    assert.match(html, /Calming<\/div><div class="wars-chips"><button data-place="sd">Sudan<span class="arrow down"/);
    assert.match(html, /data-action="list"/);
  });
  test('the overview\'s tensions: three pairs, biggest surge first, each selecting its first country; none says so', async () => {
    await create({ current: { ...CURRENT, activity: { gdelt: { tensions: TENSIONS } } } });
    const html = ds.details(null);
    assert.match(html, /Tensions · news, 7 days/);
    const rows = [...html.matchAll(/<button data-place="([\w-]+)" title="([^"]+)">\s*<span class="name">([^<]+)<\/span><span class="when">([^<]+)</g)].map(m => [m[1], m[3], m[4]]);
    assert.deepEqual(rows, [['af', 'Afghanistan – Pakistan', '209 · usually 57'], ['gb', 'United Kingdom – Iran', '102 · usually 22'], ['il', 'Israel – Gaza, West Bank', '90 · usually 20']]);
    assert.match(html, /title="Afghanistan – Pakistan: 209 military news reports between them in 7 days, usually about 57 \(GDELT\)"/);
    await create({ current: { ...CURRENT, activity: { gdelt: { tensions: { ...TENSIONS, pairs: {} } } } } });
    assert.match(ds.details(null), /Tensions · news, 7 days<\/div>\s*<p class="latest-empty">none<\/p>/);
    await create();
    assert.doesNotMatch(ds.details(null), /Tensions/, 'no news source: no section');
  });
  test('nothing escalating says so; one month of data draws no sparkline', async () => {
    const quiet = { ...CONFLICT, places: { ua: { ...CONFLICT.places.ua } }, series: { months: ['2026-08'], wars: [16], armedConflicts: [72], deaths: [11118] } };
    await create({ conflict: quiet });
    const html = ds.details(null);
    assert.match(html, /Escalating<\/div><div class="wars-chips"><span class="dim">none<\/span>/);
    assert.doesNotMatch(html, /wars-spark/);
    assert.doesNotMatch(html, /from 9,467/, 'no month before: no comparison');
  });
  test('a place at war: its deaths, months, trend and the war with a link to UCDP', () => {
    const html = ds.details({ placeId: 'ye' });
    assert.match(html, /<h3[^>]*>Yemen<\/h3>/);
    assert.match(html, /Critical · 1,871 deaths in 12 months/);
    assert.match(html, /Escalating: 1,650 in 3 months, 75 before/);
    assert.equal((html.match(/<rect /g) ?? []).length, 12);
    assert.match(html, /September 2025<\/span><span>August 2026/);
    assert.match(html, /<button data-war="1:777" title="Yemen vs AQAP · war · 1,871 deaths">/, 'a button to its war card');
    assert.match(html, /href="https:\/\/ucdp\.uu\.se\/conflict\/777"/);
    assert.match(html, /data-action="country" data-place="ye"/);
  });
  test('a party to a war fought elsewhere; violence with no government as a side; nothing recorded', () => {
    assert.match(ds.details({ placeId: 'ru' }), /Russia vs Ukraine · war · 97,739 deaths/);
    const mx = ds.details({ placeId: 'mx' });
    assert.match(mx, /unidentified armed group vs unidentified armed group · 51 deaths/);
    assert.match(mx, /Also 2,583 killed between armed groups and 192 in attacks on civilians\./);
    const lb = ds.details({ placeId: 'lb' });
    assert.match(lb, /No conflict with a government \(25\+ deaths\)/);
    assert.match(lb, /Calming: 341 in 3 months, 2,266 before/);
    const fr = ds.details({ placeId: 'fr' });
    assert.match(fr, /Normal · none recorded in 12 months/);
    assert.match(fr, /UCDP recorded no deaths in organized violence here in the 12 months to August 2026\./);
    assert.match(fr, /href="https:\/\/ucdp\.uu\.se\/"/, 'the source\'s home');
  });
  test('the tooltip, the legend by deaths, and the header with the data month', async () => {
    assert.match(ds.tooltip('ye'), /<strong>Yemen<\/strong>.*Critical · 1,871 deaths in 12 months.*Escalating: more deaths/);
    assert.match(ds.tooltip('fr'), /Normal · none recorded/);
    assert.match(ds.legend(), /Deaths, 12 months:.*1,000\+.*100–999.*25–99.*Under 25.*No data.*Level changed ≤ 30 days/);
    assert.equal(ds.header(), 'Conflict data to August 2026');
    assert.equal(ds.stale(), false, 'monthly data: the month says how old it is');
    assert.equal(ds.id, 'wars');
    await create({ current: { ...CURRENT, categories: { ...CURRENT.categories, conflict: { ...CURRENT.categories.conflict, status: 'delayed' } } } });
    assert.equal(ds.header(), 'UCDP delayed · Conflict data to August 2026');
  });
  test('a place without data (the source down) says so', async () => {
    await create({ current: { ...CURRENT, categories: { conflict: { sources: ['ucdp'], default: null, status: 'error' } }, places: {} } });
    assert.match(ds.details({ placeId: 'fr' }), /No data/);
    assert.match(ds.tooltip('fr'), /No data/);
  });
  test('there are no alerts here: an event target shows its place, or the overview', () => {
    assert.equal(ds.details({ eventId: 'gdacs:TC:1', placeId: 'ye' }), ds.details({ placeId: 'ye' }));
    assert.equal(ds.details({ eventId: 'gdacs:EQ:2' }), ds.details(null));
    assert.deepEqual(ds.markers(), []);
  });
});

describe('wars: the list, the war card, the map', () => {
  // A stand-in for the feed's DOM: the list, its section's title and count, and its clicks.
  function fakeFeed() {
    const title = { textContent: '' }, count = { textContent: '' };
    const section = { hidden: true, querySelector: (sel) => (sel === '#recentTitle' ? title : count) };
    return { el: { innerHTML: '', closest: () => section }, section, title, count };
  }

  test('the Wars list replaces the feed: who fights whom, the deaths, the title and trend; the first 8, then all and those gone quiet', async () => {
    const f = fakeFeed();
    ds.renderFeed(f.el);
    assert.equal(f.section.hidden, false);
    assert.equal(f.title.textContent, 'Wars and armed conflicts');
    assert.equal(f.count.textContent, 5);
    const rows = [...f.el.innerHTML.matchAll(/data-key="war:([\d:]+)"[^>]*>\s*<span class="row"><span class="swatch" style="--c:([^"]+)"><\/span><span class="name">([^<]+)<\/span><span class="when">([^<]+)</g)].map(m => m.slice(1));
    assert.deepEqual(rows[0], ['1:13243', 'var(--l4)', 'Russia vs Ukraine', '97,739']);
    assert.deepEqual(rows[1], ['1:309', 'var(--l4)', 'Sudan vs SFA, RSF', '5,099']);
    assert.deepEqual(rows.at(-1), ['1:12', 'var(--l2)', 'unidentified armed group vs unidentified armed group', '51']);
    assert.match(f.el.innerHTML, /<span class="what"><span class="arrow down"[^>]*>▼<\/span>Sudanese civil war<\/span>/);
    assert.doesNotMatch(f.el.innerHTML, /Gone quiet/, 'not before "Show all"');
    assert.match(f.el.innerHTML, /data-feed-all>Show all 5</, 'one conflict gone quiet: more to show');
    f.el.onclick({ target: { closest: () => ({}) } });
    assert.match(f.el.innerHTML, /<li class="recent-sub"[^>]*>Gone quiet<\/li><li><button data-key="war:1:299"[^>]*>\s*<span class="row"><span class="swatch" style="--c:var\(--risk-normal\)"><\/span><span class="name">Syrian civil war<\/span><span class="when">2,238/);
    assert.match(f.el.innerHTML, /No deaths since July 2025/);
    f.el.onclick({ target: { closest: () => null } });
    assert.deepEqual([ds.feedTarget('war:1:309'), ds.feedKeyFor({ warKey: '1:309' }), ds.feedKeyFor({ placeId: 'sd' })], [{ warKey: '1:309' }, 'war:1:309', null]);
    assert.equal(ds.settingsHidden, true, 'no Filters: they only filtered the feed');
  });

  test('a war\'s card: who fights whom in two columns, with Wikipedia\'s countries and backers; the deaths, months and summary', () => {
    const html = ds.details({ warKey: '1:309' });
    assert.match(html, /War · since April 2023/);
    assert.match(html, /<h3[^>]*>Sudanese civil war<\/h3>/);
    assert.match(html, /<div class="war-side a">\s*<div class="war-names" title="Sudan"><button data-place="sd">Sudan<\/button><\/div>\s*<div class="war-extra"><span title="with Egypt">with Egypt<\/span> · <span title="backed by Turkey, China, United States, United Arab Emirates">backed by Turkey, China, United States \+1<\/span><\/div>/);
    assert.match(html, /<div class="war-side b">\s*<div class="war-names" title="Sudan Founding Alliance \(SFA\), Rapid Support Forces \(RSF\)"><span class="war-vs">vs<\/span> <span title="SFA">Sudan Founding Alliance<\/span>, <span title="RSF">Rapid Support Forces<\/span>/);
    assert.match(html, /title="2,232 of them civilians \(UCDP\)"><span class="swatch"><\/span>5,099 deaths in 12 months/);
    assert.match(html, /<span class="arrow down"[^>]*>▼<\/span>Calming · 204 deaths in August 2026/);
    assert.equal((html.match(/<rect /g) ?? []).length, 12);
    assert.match(html, /<div class="wars-bars" title="Deaths per month · peak 483">/, 'no label on the war card: the peak in the title');
    assert.match(html, /<div class="war-names" title="[^"]*"><span class="war-vs">vs<\/span> <span title="SFA">/, 'side B starts with "vs"');
    assert.match(html, /<p class="war-extract" title="A civil war[^"]*">A civil war between/);
    assert.match(html, /Summary: Wikipedia, CC BY-SA 4\.0/);
    assert.match(html, /href="https:\/\/en\.wikipedia\.org\/wiki\/Sudanese_civil_war[^"]*"[^>]*>Wikipedia ↗/);
    assert.match(html, /href="https:\/\/ucdp\.uu\.se\/conflict\/309"/);
    assert.doesNotMatch(html, /Map ↗/, 'no map for Sudan in the fixture');
    assert.match(ds.details({ warKey: '1:13243' }), /Map ↗/);
    assert.match(ds.details({ warKey: '1:13243' }), /with Belarus, North Korea/);
  });

  test('a war without an article, one gone quiet, and an unknown one', async () => {
    const ye = ds.details({ warKey: '1:777' });
    assert.match(ye, /<div class="eyebrow">War<\/div>/, 'no start without Wikipedia');
    assert.match(ye, /<h3[^>]*>Yemen: Government<\/h3>/);
    assert.match(ye, /The sides as UCDP records them\. No Wikipedia article is linked/);
    assert.match(ye, /▲<\/span>Escalating · 1,380 deaths in August 2026/);
    const sy = ds.details({ warKey: '1:299' });
    assert.match(sy, /Gone quiet · since March 2011/);
    assert.match(sy, /No deaths since July 2025/);
    assert.match(sy, /2,238 deaths in the 12 months before/);
    assert.doesNotMatch(sy, /war-sides|<rect /);
    assert.equal(ds.details({ warKey: '1:999' }), ds.details(null), 'unknown: the overview');
    await create({ wars: null, dots: null });
    assert.match(ds.details({ warKey: '1:13243' }), /<h3[^>]*>Russia – Ukraine<\/h3>/, 'no wars.json: UCDP\'s name');
    assert.deepEqual(ds.points(), []);
  });

  test('the map shows a war: its sides in two colours, the allies lighter, where it is fought, the rest faded', () => {
    assert.equal(ds.focus({ warKey: '1:13243' }), true);
    assert.equal(ds.focus({ warKey: '1:13243' }), false, 'the same war: nothing to repaint');
    assert.equal(ds.style('ru').cls, 'side-a');
    assert.equal(ds.style('ua').cls, 'side-b');
    assert.deepEqual([ds.style('by').cls, ds.style('by').dim, ds.style('by').dot], ['side-a ally', false, true]);
    assert.deepEqual([ds.style('fr').muted, ds.style('fr').dot], [true, false], 'the rest: muted grey');
    assert.equal(ds.style('ye').pulse, null);
    ds.focus({ warKey: '1:777' });
    assert.deepEqual([ds.style('ye').cls, ds.style('ye').dim], ['side-a', false]);
    ds.focus({ warKey: '1:299' });
    assert.deepEqual([ds.style('sy').cls, ds.style('sy').muted], ['fought', false], 'gone quiet: its place shown where it was fought');
    ds.focus({ warKey: '1:309' });
    assert.equal(ds.style('eg').cls, 'side-a ally');
    assert.equal(ds.focus(null), true);
    assert.deepEqual([ds.style('fr').muted, ds.style('fr').dim], [false, false], 'no war shown: the usual map');
    assert.deepEqual([ds.hasWar('1:309'), ds.hasWar('1:299'), ds.hasWar('9:9')], [true, true, false]);
    assert.deepEqual([ds.warPlaces('1:13243'), ds.warPlaces('1:299')], [['ua', 'ru'], ['sy']]);
  });

  test('the month\'s deaths: one dot per country at its centre, sized by its deaths; another war\'s country faded; explained; a click picks its war', () => {
    const pts = ds.points();
    assert.deepEqual(pts.map(p => p.id), ['ua', 'sd', 'mx'], 'most deaths first');
    assert.deepEqual(pts[0], { id: 'ua', placeId: 'ua', r: 6.5, dim: false });
    ds.focus({ warKey: '1:309' });
    assert.deepEqual(ds.points().map(p => p.dim), [true, false, true]);
    const tip = ds.pointTooltip('sd');
    assert.match(tip, /<strong>Sudan<\/strong>/);
    assert.match(tip, /August 2026: 27 deaths/);
    assert.match(tip, /Sudan vs SFA \+1 · 27/, 'its deadliest conflict, who fights whom');
    assert.match(ds.pointTooltip('mx'), /unidentified armed group - unidentified armed group · 3/, 'a non-state conflict by UCDP\'s name');
    assert.equal(ds.pointTooltip('fr'), '');
    assert.deepEqual([ds.pointTarget('ua'), ds.pointTarget('mx'), ds.pointTarget('fr')], [{ warKey: '1:13243' }, { placeId: 'mx' }, null], 'no listed war: its country');
    assert.match(ds.legend(), /<span class="legend-dot"><\/span>Deaths in August 2026/);
  });

  test('the footer is one line with the sources and "How it works"; the wars are in the search; a war in the phone\'s sheet', () => {
    const footer = ds.footer();
    assert.match(footer, /^Data: <a href="https:\/\/ucdp\.uu\.se\/"[^>]*>UCDP<\/a>; Wikipedia text CC BY-SA 4\.0 · <button class="link-btn" data-action="help">How it works<\/button>$/);
    const wars = ds.searchEntries().filter(e => e.target.warKey);
    assert.equal(wars.length, 5);
    assert.deepEqual(wars[1], { label: 'Sudan vs SFA, RSF', aliases: ['Sudanese civil war', 'Sudan: Government'], swatch: 'var(--l4)', sub: 'War · 5,099 deaths in 12 months', target: { warKey: '1:309' } });
    assert.equal(wars[4].sub, 'Armed conflict · 51 deaths in 12 months');
    assert.match(ds.warTooltip('1:309'), /<strong>Sudan vs SFA, RSF<\/strong>.*5,099 deaths in 12 months/s);
    assert.match(ds.warTooltip('1:299'), /No deaths since July 2025/);
    assert.equal(ds.warTooltip('9:9'), '');
  });
});
