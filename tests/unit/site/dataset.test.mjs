// The travel-advisories dataset module (views and rules) with a small fake provider file,
// real English messages and in-memory settings. No browser needed.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTravelAdvisories } from '../../../site/js/datasets/travel-advisories/index.js';
import { createI18n } from '../../../site/js/core/i18n.js';
import { createSettings } from '../../../site/js/core/settings.js';
import { prepareEntries, rankMatches } from '../../../site/js/ui/search.js';

const EN = JSON.parse(readFileSync(new URL('../../../site/i18n/en.json', import.meta.url), 'utf8'));
const TODAY = new Date(2026, 8, 27);
const PLACES = new Map([
  ['mm', { id: 'mm', name: 'Myanmar', iso2: 'MM', shape: 'Myanmar' }],
  ['so', { id: 'so', name: 'Somalia', iso2: 'SO', shape: 'Somalia' }],
  ['somaliland', { id: 'somaliland', name: 'Somaliland', shape: 'Somaliland' }],
  ['il', { id: 'il', name: 'Israel', iso2: 'IL', shape: 'Israel' }],
  ['gaza', { id: 'gaza', name: 'Gaza', shape: 'Gaza' }],
  ['fr', { id: 'fr', name: 'France', iso2: 'FR', shape: 'France' }],
  ['us', { id: 'us', name: 'United States', iso2: 'US', shape: 'United States of America' }],
  ['pr', { id: 'pr', name: 'Puerto Rico', iso2: 'PR', shape: 'Puerto Rico' }],
  ['aq', { id: 'aq', name: 'Antarctica', iso2: 'AQ', shape: 'Antarctica' }],
]);
const MANIFEST = {
  id: 'travel-advisories', scale: { type: 'levels', values: [1, 2, 3, 4] }, recentWindows: [0, 7, 30, 90], defaultRecentWindow: 30,
  providers: [{ id: 'us', flag: 'us', file: 'travel-advisories/us.json' }, { id: 'ca', flag: 'ca', file: 'travel-advisories/ca.json' }],
};
const US = {
  dataset: 'travel-advisories', provider: 'us', asOf: '2026-09-26', links: { list: 'https://travel.state.gov/list' }, home: 'us', territories: ['pr'],
  records: [
    { title: 'Burma', level: 4, updated: '2026-09-25', url: 'https://travel.state.gov/mm', change: '<img src=x onerror="alert(1)">', places: ['mm'] },
    { title: 'Somalia', level: 4, updated: '2026-01-01', places: ['so'], covers: ['somaliland'] },
    { title: 'Israel and Palestine', level: 3, updated: '2026-09-20', places: ['il', 'gaza'], regional: true },
    { title: 'France', level: 2, updated: '2026-09-24', change: 'Health – editorial change', minorUpdate: true, places: ['fr'],
      levelChange: { date: '2026-09-24', from: 1, to: 2 } },
    { title: 'French West Indies', level: 1, updated: '2024-08-22', places: [], noteKey: 'frenchWestIndies' },
  ],
};
const CA = { ...US, provider: 'ca', asOf: '2026-09-01', links: { list: 'javascript:alert(1)' }, home: 'ca', territories: [],
  records: [{ title: 'Myanmar', level: 3, updated: '2026-09-01', places: ['mm'] }] };

let ds, changes;
async function create(saved = {}) {
  const storage = new Map(Object.entries({ 'travel-risk-map:settings': JSON.stringify({ 'travel-advisories': saved }) }));
  const settings = createSettings('travel-risk-map:settings', {}, { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) });
  const client = { file: async (path) => (path.endsWith('/ca.json') ? CA : US) };
  changes = 0;
  ds = createTravelAdvisories({ i18n: createI18n({ locale: 'en', messages: EN, today: TODAY }), settings, client, manifest: MANIFEST, places: PLACES, changed: () => changes++ });
  await ds.load();
  return ds;
}
beforeEach(() => create());

describe('map style', () => {
  test('colours a place by its record level and gives its own record a dot', () => {
    assert.deepEqual(ds.style('mm'), { cls: 'l4', muted: false, dim: false, dot: true, pulse: ds.style('mm').pulse });
    assert.ok(ds.style('mm').pulse > 0, 'recent real update pulses');
  });
  test('covered and shared places are coloured but get no dot', () => {
    assert.equal(ds.style('somaliland').cls, 'l4');
    assert.equal(ds.style('somaliland').dot, false);
    assert.equal(ds.style('gaza').dot, false);
  });
  test('a shared record pulses only on its first place', () => {
    assert.ok(ds.style('il').pulse > 0);
    assert.equal(ds.style('gaza').pulse, null);
  });
  test('a level change pulses even though the update was minor', () => assert.ok(ds.style('fr').pulse > 0));
  test('an old update does not pulse; a place without a record is plain', () => {
    assert.equal(ds.style('so').pulse, null);
    assert.deepEqual(ds.style('aq'), { cls: 'none', muted: false, dim: false, dot: false, pulse: null });
  });
  test('hidden levels are muted and lose their pulse; fading dims places without recent updates', async () => {
    await create({ levels: [1, 2, 3], dimOthers: true });
    assert.equal(ds.style('mm').muted, true);
    assert.equal(ds.style('mm').pulse, null);
    assert.equal(ds.style('so').dim, true);
    assert.equal(ds.style('aq').dim, true);
    assert.equal(ds.style('il').dim, false);
  });
  test('with highlighting off nothing pulses or dims', async () => {
    await create({ recentDays: 0, dimOthers: true });
    assert.equal(ds.style('mm').pulse, null);
    assert.equal(ds.style('so').dim, false);
  });
});

describe('details card', () => {
  test('overview counts advisories and recent updates', () => {
    const html = ds.details(null);
    assert.match(html, /5 advisories/);
    assert.match(html, /<strong>3<\/strong> updated in the last 30 days/);
  });
  test('shows the neutral place name and escapes text from the source', () => {
    const html = ds.details({ placeId: 'mm' });
    assert.match(html, /<h3[^>]*>Myanmar<\/h3>/);
    assert.match(html, /Level 4 · Do not travel/);
    assert.ok(!html.includes('<img'), 'source HTML must never be injected');
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.match(html, /href="https:\/\/travel\.state\.gov\/mm"/);
  });
  test('the last-updated row carries its full text as a tooltip (it may be shortened on narrow panels)', () => {
    assert.ok(ds.details({ placeId: 'mm' }).includes('<dd title="Sep 25, 2026 · 2 days ago">Sep 25, 2026 · 2 days ago</dd>'));
  });
  test('covered and shared places say which advisory covers them', () => {
    assert.match(ds.details({ placeId: 'somaliland' }), /Covered by Somalia/);
    assert.match(ds.details({ placeId: 'gaza' }), /Covered by Israel and Palestine/);
    assert.match(ds.details({ placeId: 'gaza' }), /Regional advisories/);
  });
  test('minor updates and level changes are labelled', () => {
    const html = ds.details({ placeId: 'fr' });
    assert.match(html, /Minor edit/);
    assert.match(html, /class="fresh up"[^>]*>Level 1 → 2 · Sep 24, 2026/);
  });
  test('a record without a place shows its title and note', () => {
    const html = ds.details({ recordKey: 'French West Indies' });
    assert.match(html, /French West Indies/);
    assert.match(html, /See also Guadeloupe/);
  });
  test('explains why a place has no advisory', () => {
    assert.match(ds.details({ placeId: 'us' }), /only for destinations abroad/);
    assert.match(ds.details({ placeId: 'pr' }), /U\.S\. territory/);
    assert.match(ds.details({ placeId: 'aq' }), /no advisory for this place/);
  });
});

describe('header, footer, tooltip, legend', () => {
  test('the footer links the agency to its list; unsafe links are dropped', async () => {
    assert.match(ds.footer(), /<a id="sourceLink" href="https:\/\/travel\.state\.gov\/list"[^>]*>U\.S\. State Department<\/a>/);
    await ds.setProvider('ca');
    assert.ok(!ds.footer().includes('href='), 'javascript: link must not be rendered');
    assert.ok(!ds.details({ placeId: 'mm' }).includes('javascript:'));
  });
  test('the header shows the data date, with its age once it is over a week old', async () => {
    assert.equal(ds.header(), 'U.S. State Department advisories · data as of Sep 26, 2026');
    await ds.setProvider('ca');
    assert.match(ds.header(), /Government of Canada advisories · data as of Sep 1, 2026 \(26 days ago\)/);
  });
  test('the tooltip names the place and its level', () => {
    const html = ds.tooltip('mm');
    assert.match(html, /<strong>Myanmar<\/strong>/);
    assert.match(html, /Level 4 · Do not travel/);
    assert.match(ds.tooltip('aq'), /No advisory/);
  });
  test('the legend shows the recent marker only while highlighting is on', async () => {
    assert.match(ds.legend(), /Updated ≤ 30 days/);
    await create({ recentDays: 0 });
    assert.ok(!ds.legend().includes('Updated ≤'));
  });
});

describe('providers, feed and search', () => {
  test('lists providers with short labels and switches data', async () => {
    assert.deepEqual(ds.providers().map(p => [p.id, p.label]), [['us', 'U.S.'], ['ca', 'Canada']]);
    await ds.setProvider('ca');
    assert.equal(ds.provider(), 'ca');
    assert.equal(ds.style('mm').cls, 'l3');
  });
  test('an unknown saved provider falls back to the first one', async () => {
    await create({ provider: 'xx' });
    assert.equal(ds.provider(), 'us');
  });
  test('feed items map to targets and back', () => {
    assert.deepEqual(ds.feedTarget('Burma'), { placeId: 'mm' });
    assert.deepEqual(ds.feedTarget('French West Indies'), { recordKey: 'French West Indies' });
    assert.equal(ds.feedTarget('nope'), null);
    assert.equal(ds.feedKeyFor({ placeId: 'somaliland' }), 'Somalia');
  });
  test('search finds places by name and by the source\'s own name', () => {
    const entries = prepareEntries(ds.searchEntries());
    assert.equal(rankMatches(entries, 'burma')[0].label, 'Myanmar');
    assert.deepEqual(rankMatches(entries, 'burma')[0].target, { placeId: 'mm' });
    assert.deepEqual(rankMatches(entries, 'french west')[0].target, { recordKey: 'French West Indies' });
    assert.equal(rankMatches(entries, 'antarc')[0].sub, 'No advisory');
  });
});

describe('search ranking', () => {
  const entries = prepareEntries([{ label: 'Niger' }, { label: 'Nigeria' }, { label: 'Côte d’Ivoire' }, { label: 'Papua New Guinea' }, { label: 'Guinea' }]);
  test('names starting with the query come first', () => assert.deepEqual(rankMatches(entries, 'guinea').map(e => e.label), ['Guinea', 'Papua New Guinea']));
  test('ignores accents and case', () => assert.equal(rankMatches(entries, 'COTE')[0].label, 'Côte d’Ivoire'));
  test('limits the number of results and ignores blank queries', () => {
    assert.equal(rankMatches(entries, 'i', 2).length, 2);
    assert.deepEqual(rankMatches(entries, '   '), []);
  });
});
