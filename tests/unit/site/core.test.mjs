// Unit tests for the site's pure modules (they run in Node: no DOM needed).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createI18n, chooseLocale } from '../../../site/js/core/i18n.js';
import { createSettings } from '../../../site/js/core/settings.js';
import { createDataClient } from '../../../site/js/core/data-client.js';
import { esc, safeUrl } from '../../../site/js/core/dom.js';

const EN = {
  meta: { name: 'English', dir: 'ltr' },
  greeting: 'Hello, {name}!',
  count: { one: '{count} advisory', other: '{count} advisories' },
  onlyEnglish: 'Fallback text',
  places: { gaza: 'Gaza Strip' },
};
const UK = { meta: { name: 'Українська', dir: 'ltr' }, greeting: 'Привіт, {name}!' };
const TODAY = new Date(2026, 8, 27);   // Sep 27, 2026 (local)

describe('i18n', () => {
  const en = createI18n({ locale: 'en', messages: EN, today: TODAY });
  const uk = createI18n({ locale: 'uk', messages: UK, fallback: EN, today: TODAY });

  test('fills placeholders', () => assert.equal(en.t('greeting', { name: 'Ann' }), 'Hello, Ann!'));
  test('chooses plural forms', () => {
    assert.equal(en.t('count', { count: 1 }), '1 advisory');
    assert.equal(en.t('count', { count: 5 }), '5 advisories');
  });
  test('falls back to English, then to the key', () => {
    assert.equal(uk.t('greeting', { name: 'Ann' }), 'Привіт, Ann!');
    assert.equal(uk.t('onlyEnglish'), 'Fallback text');
    assert.equal(uk.t('missing.key'), 'missing.key');
  });
  test('leaves unknown placeholders visible rather than blank', () => assert.equal(en.t('greeting'), 'Hello, {name}!'));
  test('computes ages in whole days', () => {
    assert.equal(en.ageDays('2026-09-27'), 0);
    assert.equal(en.ageDays('2026-09-16'), 11);
    assert.equal(en.ageDays('2026-10-01'), 0, 'future dates count as today');
  });
  test('formats ages like the original English UI', () => {
    assert.equal(en.relativeAge(0), 'today');
    assert.equal(en.relativeAge(1), 'yesterday');
    assert.equal(en.relativeAge(11), '11 days ago');
    assert.equal(en.relativeAge(120), '4 months ago');
    assert.equal(en.shortAge(11), '11d ago');
    assert.equal(en.formatDate('2026-09-26'), 'Sep 26, 2026');
  });
  test('formats ages in hours for data that changes within a day', () => {
    assert.equal(en.relativeHours(0.4), '24 minutes ago');
    assert.equal(en.relativeHours(5.9), '5 hours ago');
    assert.equal(en.relativeHours(30), 'yesterday');
    assert.equal(en.shortHours(0.4), '24m ago');
    assert.equal(en.shortHours(5), '5h ago');
    assert.equal(en.shortHours(24 * 11), '11d ago');
  });
  test('formats ages in other languages via Intl', () => {
    assert.equal(uk.relativeAge(1), 'учора');
    assert.notEqual(uk.relativeAge(11), en.relativeAge(11));
  });
  test('place names: locale override, curated English, then Intl by ISO code', () => {
    assert.equal(en.placeName({ id: 'gaza', name: 'Gaza' }), 'Gaza Strip');
    assert.equal(en.placeName({ id: 'cd', name: 'Democratic Republic of the Congo', iso2: 'CD' }), 'Democratic Republic of the Congo');
    assert.equal(uk.placeName({ id: 'fr', name: 'France', iso2: 'FR' }), 'Франція');
    assert.equal(uk.placeName({ id: 'azores', name: 'Azores' }), 'Azores', 'no ISO code: registry name');
  });
});

describe('chooseLocale', () => {
  const available = ['en', 'uk'];
  test('prefers a saved choice', () => assert.equal(chooseLocale(available, { saved: 'uk', browser: ['en-US'] }), 'uk'));
  test('then the browser languages, matching the base language', () => assert.equal(chooseLocale(available, { browser: ['uk-UA', 'en'] }), 'uk'));
  test('then the default', () => assert.equal(chooseLocale(available, { browser: ['fr-FR'], fallback: 'en' }), 'en'));
  test('ignores a saved choice that is no longer available', () => assert.equal(chooseLocale(['en'], { saved: 'uk' }), 'en'));
});

describe('settings', () => {
  const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };

  test('persists values and notifies listeners', () => {
    const storage = memory();
    const s = createSettings('k', { theme: 'auto' }, storage);
    const seen = [];
    s.subscribe((key, value) => seen.push([key, value]));
    s.set('theme', 'dark');
    assert.equal(createSettings('k', { theme: 'auto' }, storage).get('theme'), 'dark');
    assert.deepEqual(seen, [['theme', 'dark']]);
  });
  test('scopes a dataset\'s settings under its id, with defaults', () => {
    const storage = memory();
    const s = createSettings('k', {}, storage);
    const scoped = s.scope('travel-advisories', { recentDays: 30 });
    assert.equal(scoped.get('recentDays'), 30);
    scoped.set('recentDays', 7);
    assert.deepEqual(JSON.parse(storage.m.get('k'))['travel-advisories'], { recentDays: 7 });
  });
  test('works with defaults when storage is broken or unavailable', () => {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const s = createSettings('k', { theme: 'auto' }, broken);
    s.set('theme', 'dark');
    assert.equal(s.get('theme'), 'dark');
    assert.equal(createSettings('k', { theme: 'auto' }, null).get('theme'), 'auto');
  });
  test('ignores corrupt saved JSON', () => {
    assert.equal(createSettings('k', { theme: 'auto' }, { getItem: () => '{not json', setItem() {} }).get('theme'), 'auto');
  });
});

describe('data client', () => {
  test('fetches the manifest, files and messages from their paths, caching responses', async () => {
    const calls = [];
    const fetchFn = async (url) => { calls.push(url); return { ok: true, json: async () => ({ url }) }; };
    const client = createDataClient({ base: 'data/', i18nBase: 'i18n/', fetchFn });
    assert.deepEqual(await client.manifest(), { url: 'data/manifest.json' });
    await client.file('places.json');
    await client.file('places.json');
    await client.messages('en');
    assert.deepEqual(calls, ['data/manifest.json', 'data/places.json', 'i18n/en.json']);
  });
  test('always revalidates the manifest, and versions a file by its as-of time so a new one is never served stale', async () => {
    const calls = [];
    const fetchFn = async (url, init) => { calls.push([url, init?.cache]); return { ok: true, json: async () => ({}) }; };
    const client = createDataClient({ fetchFn });
    await client.manifest();
    await client.file('risk/current.json', '2026-09-27T16:41:22.739Z');
    await client.file('risk/current.json', '2026-09-27T17:41:22.739Z');
    assert.deepEqual(calls, [
      ['data/manifest.json', 'no-cache'],
      ['data/risk/current.json?v=2026-09-27T16%3A41%3A22.739Z', undefined],
      ['data/risk/current.json?v=2026-09-27T17%3A41%3A22.739Z', undefined],
    ]);
  });
  test('rejects on HTTP errors and does not cache failures', async () => {
    let fail = true;
    const fetchFn = async () => (fail ? { ok: false, status: 503 } : { ok: true, json: async () => 'ok' });
    const client = createDataClient({ fetchFn });
    await assert.rejects(client.manifest(), /HTTP 503/);
    fail = false;
    assert.equal(await client.manifest(), 'ok');
  });
});

describe('dom helpers', () => {
  test('esc neutralizes HTML from source data', () => {
    assert.equal(esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });
  test('safeUrl only allows http(s) links', () => {
    assert.equal(safeUrl('https://travel.gc.ca/x'), 'https://travel.gc.ca/x');
    assert.equal(safeUrl('javascript:alert(1)'), null);
    assert.equal(safeUrl('not a url'), null);
  });
});
