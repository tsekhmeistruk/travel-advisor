import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTable, parseLatestUpdate, planPageReads } from '../../../scripts/providers/ca/parse.mjs';

const fixture = (f) => readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8');

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
});
