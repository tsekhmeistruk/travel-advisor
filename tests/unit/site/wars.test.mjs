// The Wars mode: its pure rules (logic.js) and its cards, legend and header, with a small
// conflict file shaped like lib/conflict.mjs publishes it, real English messages and a fixed clock.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWarsMode } from '../../../site/js/datasets/wars/index.js';
import {
  windowMonths, bandRows, conflictTitle, conflictName, overviewModel, placeModel, sparkPoints, barRects, conflictUrl, tensionRows,
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
  conflicts: {
    '1:13243': { name: 'Russia - Ukraine', sideA: 'Government of Russia (Soviet Union)', sideB: 'Government of Ukraine', deaths12: 97739, last: 5702, war: true, places: ['ua', 'ru'], parties: ['ru', 'ua'] },
    '1:119': { name: null, sideA: 'XXX475', sideB: 'XXX475', deaths12: 2595, last: 450, war: true, places: ['ng'], parties: ['ng'] },
    '1:777': { name: 'Yemen (North Yemen): Government', sideA: 'Government of Yemen (North Yemen)', sideB: 'AQAP', deaths12: 1871, last: 1380, war: true, places: ['ye'], parties: ['ye'] },
    '1:12': { name: null, sideA: 'XXX70', sideB: 'XXX70', deaths12: 51, last: 3, war: false, places: ['mx'], parties: [] },
  },
  places: {
    ua: { deaths12: 97381, months: [9298, 10281, 10350, 10117, 13372, 7436, 7772, 6857, 6656, 4725, 4869, 5648], byType: { state: 97336, nonState: 0, oneSided: 45 }, trend: null, conflicts: ['1:13243'], partyTo: ['1:13243'] },
    ru: { deaths12: 448, months: [79, 43, 46, 55, 8, 2, 20, 36, 49, 34, 22, 54], byType: { state: 446, nonState: 0, oneSided: 2 }, trend: null, conflicts: ['1:13243'], partyTo: ['1:13243'] },
    ye: { deaths12: 1871, months: twelve([220, 1380, 50], 25), byType: { state: 1871, nonState: 0, oneSided: 0 }, trend: 'up', conflicts: ['1:777'], partyTo: ['1:777'] },
    lb: { deaths12: 2767, months: [23, 32, 41, 15, 22, 27, 1340, 577, 349, 295, 21, 25], byType: { state: 2767, nonState: 0, oneSided: 0 }, trend: 'down', conflicts: [], partyTo: [] },
    ng: { deaths12: 2700, months: twelve([300, 300, 300], 200), byType: { state: 2600, nonState: 50, oneSided: 50 }, trend: null, conflicts: ['1:119'], partyTo: ['1:119'] },
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
const MANIFEST = { asOf: CURRENT.asOf, current: 'risk/current.json', changes: 'risk/changes.json', events: 'risk/events.json', conflict: 'risk/conflict.json', places: 'risk/places/' };

let ds;
async function create({ current = CURRENT, conflict = CONFLICT } = {}) {
  const storage = new Map();
  const settings = createSettings('travel-risk-map:settings', {}, { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) });
  const files = { 'risk/current.json': current, 'risk/changes.json': { changes: [] }, 'risk/events.json': { events: [] }, 'risk/conflict.json': conflict };
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
    assert.deepEqual([m.escalating, m.calming], [['ye'], ['lb']]);
    assert.deepEqual(overviewModel({ ...CONFLICT, places: { ...CONFLICT.places, ng: { ...CONFLICT.places.ng, trend: 'up' } } }).escalating, ['ye', 'ng'], 'most deaths in the last 3 months first');
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

describe('the mode', () => {
  test('the overview: the war count, the month\'s deaths, escalating and calming as buttons to their place', () => {
    const html = ds.details(null);
    assert.match(html, /Wars now · UCDP, to August 2026/);
    assert.match(html, /<b>16<\/b><span>wars<\/span>/);
    assert.match(html, /12 in August 2025/);
    assert.match(html, /And 56 smaller armed conflicts\. A war: 1,000\+ deaths in 12 months, a government on one side\./);
    assert.match(html, /Deaths in August 2026: 11,118 <span class="arrow up"[^>]*>▲<\/span> <span class="dim">from 9,467<\/span>/);
    assert.match(html, /Escalating<\/div><div class="wars-chips"><button data-place="ye">Yemen<span class="arrow up"/);
    assert.match(html, /Calming<\/div><div class="wars-chips"><button data-place="lb">Lebanon<span class="arrow down"/);
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
    assert.match(html, /Yemen: Government · war · 1,871 deaths/);
    assert.match(html, /href="https:\/\/ucdp\.uu\.se\/conflict\/777"/);
    assert.match(html, /data-action="country" data-place="ye"/);
  });
  test('a party to a war fought elsewhere; violence with no government as a side; nothing recorded', () => {
    assert.match(ds.details({ placeId: 'ru' }), /Russia – Ukraine · war · 97,739 deaths/);
    const mx = ds.details({ placeId: 'mx' });
    assert.match(mx, /Mexico: unnamed armed group|Armed conflict in Mexico · 51 deaths/);
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
