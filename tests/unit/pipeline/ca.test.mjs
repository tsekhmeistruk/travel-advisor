import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTable, parseFeed, combineSources } from '../../../scripts/providers/ca/parse.mjs';

const fixture = (f) => readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8');

describe('parseFeed', () => {
  const feed = JSON.parse(fixture('canada-feed.json'));
  const { generated, entries } = parseFeed(feed);
  const byName = new Map(entries.map(e => [e.name, e]));

  test('reads every destination of the real feed with its generation time', () => {
    assert.equal(generated, '2026-09-26 02:00:17');
    assert.deepEqual([...byName.keys()].sort(), ['Afghanistan', 'Algeria', "Côte d'Ivoire (Ivory Coast)", 'Israel and Palestine', 'Japan', 'Mexico']);
  });

  test('maps advisory-state 0–3 to levels 1–4, with regional flags', () => {
    assert.deepEqual(['Japan', 'Algeria', 'Israel and Palestine', 'Afghanistan'].map(n => byName.get(n).level), [1, 2, 3, 4]);
    assert.equal(byName.get('Algeria').regional, true);
    assert.equal(byName.get('Afghanistan').regional, false);
  });

  test('keeps the full timestamp, the date, the page URL and the ISO code, and no change notes', () => {
    assert.deepEqual(byName.get('Mexico'), {
      name: 'Mexico', level: 2, regional: true, updated: '2026-09-26', stamp: '2026-09-26 01:43:09',
      url: 'https://travel.gc.ca/destinations/mexico', iso: 'MX',
    });
  });

  test('uses the same names and URLs as the advisory table (history and aliases depend on it)', () => {
    const table = parseTable(fixture('canada-table.html'));
    for (const t of table) assert.equal(byName.get(t.name)?.url, t.url, t.name);
  });

  test('rejects unknown levels, bad dates and a missing data object', () => {
    const one = (patch) => ({ data: { AF: { ...feed.data.AF, ...patch } } });
    assert.throws(() => parseFeed(one({ 'advisory-state': 4 })), /Unknown advisory-state "4"/);
    assert.throws(() => parseFeed(one({ 'date-published': { date: 'yesterday' } })), /Bad date-published/);
    assert.throws(() => parseFeed(one({ eng: { name: 'X' } })), /without an English name or slug/);
    assert.throws(() => parseFeed({}), /no "data" object/);
  });
});

describe('combineSources', () => {
  const f = (name, stamp, extra = {}) => ({ name, level: 2, stamp, url: `https://travel.gc.ca/destinations/${name}`, iso: name.toUpperCase(), ...extra });
  const t = (name, stamp, extra = {}) => ({ name, level: 2, stamp, url: `https://travel.gc.ca/destinations/${name}`, ...extra });

  test('the feed wins when the table has the same timestamp', () => {
    const { entries, newerInTable } = combineSources([f('a', '2026-09-24 08:00:00', { level: 3 })], [t('a', '2026-09-24 08:00:00')]);
    assert.equal(entries[0].level, 3);
    assert.deepEqual(newerInTable, []);
  });

  test('the table wins for a newer timestamp, keeping the feed\'s ISO code', () => {
    const { entries, newerInTable } = combineSources([f('a', '2026-09-24 08:00:00')], [t('a', '2026-09-27 10:00:00', { level: 4 })]);
    assert.deepEqual([entries[0].level, entries[0].stamp, entries[0].iso], [4, '2026-09-27 10:00:00', 'A']);
    assert.deepEqual(newerInTable, ['a']);
  });

  test('keeps destinations found in only one source, sorted by name', () => {
    const { entries, newerInTable } = combineSources([f('b', '2026-09-24 08:00:00')], [t('a', '2026-09-24 08:00:00')]);
    assert.deepEqual(entries.map(e => e.name), ['a', 'b']);
    assert.deepEqual(newerInTable, ['a']);
  });

  test('works with either source missing', () => {
    assert.equal(combineSources([], [t('a', 's')]).entries.length, 1);
    assert.equal(combineSources([f('a', 's')], []).entries.length, 1);
  });
});

describe('parseTable', () => {
  const entries = parseTable(fixture('canada-table.html'));

  test('reads every row of the real advisory table', () => {
    assert.deepEqual(entries.map(e => e.name), ['Afghanistan', 'Algeria', "Côte d'Ivoire (Ivory Coast)", 'Israel and Palestine']);
  });

  test('maps risk classes to levels 1–4', () => {
    assert.deepEqual(entries.map(e => e.level), [4, 2, 2, 3]);
  });

  test('flags "(with regional advisories)"', () => {
    assert.deepEqual(entries.map(e => e.regional), [false, true, true, true]);
  });

  test('keeps the full timestamp and the date, and builds absolute links', () => {
    assert.equal(entries[0].stamp, '2026-09-24 08:53:35');
    assert.equal(entries[0].updated, '2026-09-24');
    assert.equal(entries[0].url, 'https://travel.gc.ca/destinations/afghanistan');
  });

  test('rejects an unknown risk class rather than guessing', () => {
    const broken = fixture('canada-table.html').replace("<div class='do-not-travel'>", "<div class='new-level'>");
    assert.throws(() => parseTable(broken), /Unknown risk class "new-level"/);
  });

  test('returns nothing for a page without the table', () => {
    assert.deepEqual(parseTable('<html>Service unavailable</html>'), []);
  });
});
