import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTable, parseLatestUpdate, planPageReads, parseFeed, combineSources } from '../../../scripts/providers/ca/parse.mjs';

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

  test('keeps the full timestamp, the date, the page URL, the ISO code, the English note and the change type', () => {
    assert.deepEqual(byName.get('Mexico'), {
      name: 'Mexico', level: 2, regional: true, updated: '2026-09-26', stamp: '2026-09-26 01:43:09',
      url: 'https://travel.gc.ca/destinations/mexico', change: byName.get('Mexico').change, changeType: 'Regional advisory added', iso: 'MX',
    });
    assert.match(byName.get('Mexico').change, /avoid non-essential travel to Baja California Sur/);
    assert.equal(byName.get('Japan').changeType, 'Regular text update');
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
  const f = (name, stamp, extra = {}) => ({ name, level: 2, stamp, url: `https://travel.gc.ca/destinations/${name}`, change: `${name} note`, changeType: 'Editorial change', iso: name.toUpperCase(), ...extra });
  const t = (name, stamp, extra = {}) => ({ name, level: 2, stamp, url: `https://travel.gc.ca/destinations/${name}`, ...extra });

  test('the feed wins when the table has the same timestamp', () => {
    const { entries, newerInTable } = combineSources([f('a', '2026-09-24 08:00:00')], [t('a', '2026-09-24 08:00:00')]);
    assert.equal(entries[0].change, 'a note');
    assert.deepEqual(newerInTable, []);
  });

  test('the table wins for a newer timestamp, and its note becomes unknown', () => {
    const { entries, newerInTable } = combineSources([f('a', '2026-09-24 08:00:00')], [t('a', '2026-09-27 10:00:00', { level: 4 })]);
    assert.deepEqual([entries[0].level, entries[0].change, entries[0].changeType, entries[0].iso], [4, undefined, undefined, 'A']);
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

describe('parseLatestUpdate', () => {
  test('reads the "Latest updates" line from a real destination page', () => {
    assert.equal(parseLatestUpdate(fixture('canada-destination.html')), 'Health – editorial change');
  });

  test('decodes entities and collapses whitespace', () => {
    assert.equal(parseLatestUpdate('<span id="lastUpdateTextLbl">Risk levels section &ndash;\n  avoid all travel</span>'), 'Risk levels section – avoid all travel');
  });

  test('returns null when the label is missing', () => {
    assert.equal(parseLatestUpdate('<p>no label here</p>'), null);
  });
});

describe('planPageReads', () => {
  test('reuses notes for unchanged timestamps and reads the rest', () => {
    const entries = [
      { name: 'Mexico', stamp: '2026-09-26 01:43:09' },
      { name: 'Japan', stamp: '2026-09-27 10:00:00' },
      { name: 'New', stamp: '2026-09-27 10:00:00' },
    ];
    const previous = [
      { name: 'Mexico', stamp: '2026-09-26 01:43:09', change: 'Risk levels section – …' },
      { name: 'Japan', stamp: '2026-09-25 11:47:52', change: 'Old note' },
    ];
    const toRead = planPageReads(entries, previous);
    assert.deepEqual(toRead.map(e => e.name), ['Japan', 'New']);
    assert.equal(entries[0].change, 'Risk levels section – …');
    assert.equal(entries[1].change, undefined, 'a changed page must not keep the old note');
  });

  test('re-reads a page whose earlier read failed (no note on file)', () => {
    const toRead = planPageReads([{ name: 'X', stamp: 's' }], [{ name: 'X', stamp: 's' }]);
    assert.equal(toRead.length, 1);
  });

  test('a reused note keeps its change type', () => {
    const entries = [{ name: 'X', stamp: 's' }];
    planPageReads(entries, [{ name: 'X', stamp: 's', change: 'n', changeType: 'Editorial change' }]);
    assert.deepEqual([entries[0].change, entries[0].changeType], ['n', 'Editorial change']);
  });
});
