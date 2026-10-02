// The conflict category (scripts/lib/conflict.mjs): merging UCDP versions, levels by deaths,
// the war count, trends, parties. Small hand-made versions, plus real monthly series.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addMonths, monthsBack, governments, bandLevel, trendOf, conflictSignals } from '../../../scripts/lib/conflict.mjs';

const CONFIG = JSON.parse(readFileSync(new URL('../../../config/sources/ucdp.json', import.meta.url), 'utf8'));
const COUNTRIES = { 369: 'Ukraine', 365: 'Russia (Soviet Union)', 666: 'Israel', 70: 'Mexico', 678: 'Yemen (North Yemen)', 999: 'Atlantis' };
const CONFLICTS = {
  '1:13243': { name: 'Russia - Ukraine', sideA: 'Government of Russia (Soviet Union)', sideB: 'Government of Ukraine' },
  '1:234': { name: 'Israel: Palestine', sideA: 'Government of Israel', sideB: 'Hamas' },
  '1:777': { name: 'XXX678', sideA: 'XXX678', sideB: 'XXX678' },
  '2:70': { name: 'XXX70 - XXX70', sideA: 'XXX70', sideB: 'XXX70' },
};
let nextId = 1;
const ev = (date, countryId, key, deaths, region = '') => [nextId++, date, countryId, region, key, deaths];
const version = (v, month, events, conflicts = CONFLICTS) => ({ version: v, month, fetchedAt: `${month}-28T00:00:00.000Z`, countries: COUNTRIES, conflicts, events });
const config = { ...CONFIG, seriesMonths: 15 };

describe('months, sides, bands and trends', () => {
  test('months count back across years', () => {
    assert.equal(addMonths('2026-01', -1), '2025-12');
    assert.equal(addMonths('2025-12', 2), '2026-02');
    assert.deepEqual(monthsBack('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
  });
  test('the governments on a side, by name', () => {
    assert.deepEqual(governments('Government of Israel, Government of United States of America'), ['Israel', 'United States of America']);
    assert.deepEqual(governments('Hezbollah'), []);
  });
  test('deaths in 12 months give a level: 1,000+ Critical, 100+ High, 25+ Elevated', () => {
    assert.deepEqual([0, 24, 25, 99, 100, 999, 1000, 97381].map(d => bandLevel(d, CONFIG.bands)), [1, 1, 2, 2, 3, 3, 4, 4]);
  });
  test('escalating and calming: the last 3 months against the 3 before (real UCDP series, 2026)', () => {
    const t = (months) => trendOf(months.slice(-3).reduce((a, b) => a + b, 0), months.slice(-6, -3).reduce((a, b) => a + b, 0), CONFIG.trend);
    assert.equal(t([48, 55, 50, 220, 1380, 50]), 'up', 'Yemen');   // 1,650 against 153
    assert.equal(t([1340, 577, 349, 295, 21, 25]), 'down', 'Lebanon');
    assert.equal(t([202, 202, 401, 463, 744, 551]), 'up', 'Pakistan: 1,758 against 805');
    assert.equal(t([7772, 6857, 6656, 4725, 4869, 5648]), null, 'Ukraine: 28% fewer, not half');
    assert.equal(t([10, 10, 10, 40, 40, 40]), null, 'too few deaths to call it');
  });
});

describe('conflictSignals', () => {
  // 14 months of data (2025-07 to 2026-08), the latest version is August 2026.
  const months = monthsBack('2026-08', 14);
  const steady = months.flatMap(m => [ev(`${m}-10`, 369, '1:13243', 500), ev(`${m}-11`, 365, '1:13243', 5)]);
  const versions = [
    version('25.0.7', '2025-07', steady.filter(e => e[1] < '2025-08')),
    ...months.slice(1, -1).map((m, i) => version(`${m.slice(2, 4)}.0.${Number(m.slice(5))}`, m, steady.filter(e => e[1].startsWith(m)))),
    version('26.0.8', '2026-08', [
      ...steady.filter(e => e[1].startsWith('2026-08')),
      ev('2026-08-02', 666, '1:234', 30, 'Gaza Strip'), ev('2026-08-03', 666, '1:234', 2, 'West Bank'), ev('2026-08-04', 666, '1:234', 1, 'Tel Aviv district'),
      ev('2026-06-20', 678, '1:777', 400), ev('2026-08-20', 678, '1:777', 900),   // backdated, then a new month
      ev('2026-08-05', 70, '2:70', 120), ev('2026-08-06', 999, '2:70', 5),
      ev('2026-09-01', 369, '1:13243', 1000),   // after `through`: not counted
    ]),
  ];
  const r = conflictSignals('ucdp', { fetchedAt: versions.at(-1).fetchedAt, versions }, config);

  test('through is the latest version\'s month; deaths add up per place over 12 months', () => {
    assert.equal(r.through, '2026-08');
    assert.equal(r.published.places.ua.deaths12, 6000);
    assert.equal(r.published.places.ua.months.length, 12);
    assert.deepEqual(r.published.places.ua.byType, { state: 6000, nonState: 0, oneSided: 0 });
    assert.deepEqual(r.published.places.mx.byType, { state: 0, nonState: 120, oneSided: 0 });
  });

  test('levels by the bands, with the data month as basis; Normal places have no signal', () => {
    assert.deepEqual(r.signals.get('ua'), { level: 4, basis: ['ucdp:2026-08'] });
    assert.equal(r.signals.get('ru').level, 2, '60 deaths: Elevated');
    assert.equal(r.signals.get('gaza').level, 2);
    assert.equal(r.signals.get('ye').level, 4, '1,300: a backdated event counts in its own month');
    assert.equal(r.signals.get('mx').level, 3);
    assert.equal(r.signals.has('west-bank'), false, '2 deaths: Normal');
    assert.equal(r.signals.has('il'), false);
  });

  test('a split place by its region, else the country', () => {
    assert.equal(r.published.places.gaza.deaths12, 30);
    assert.equal(r.published.places['west-bank'].deaths12, 2);
    assert.equal(r.published.places.il.deaths12, 1);
  });

  test('state-based conflicts with 25+ deaths are listed; 1,000+ is a war; parties are the governments', () => {
    const c = r.published.conflicts;
    assert.deepEqual(Object.keys(c), ['1:13243', '1:777', '1:234'], 'most deaths first; non-state conflicts are not listed');
    assert.deepEqual(c['1:13243'], {
      name: 'Russia - Ukraine', sideA: 'Government of Russia (Soviet Union)', sideB: 'Government of Ukraine',
      deaths12: 6060, last: 505, war: true, places: ['ua', 'ru'], parties: ['ru', 'ua'],
    });
    assert.equal(c['1:777'].name, null, 'not named yet: the sides say who');
    assert.deepEqual(c['1:777'].parties, ['ye'], 'XXX678: the government of country 678');
    assert.equal(c['1:234'].war, false);
    assert.deepEqual(c['1:234'].places, ['gaza', 'west-bank', 'il']);
    assert.deepEqual(r.published.places.il, { deaths12: 1, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], byType: { state: 1, nonState: 0, oneSided: 0 }, trend: null, conflicts: ['1:234'], partyTo: ['1:234'] });
    assert.deepEqual(r.published.places.ru.partyTo, ['1:13243']);
  });

  test('the war count per month, where 12 months of data are behind it', () => {
    const s = r.published.series;
    assert.equal(s.months.length, 14, 'from the first month of data');
    assert.deepEqual(s.wars.slice(0, 3), [null, null, null]);
    assert.deepEqual(s.wars.slice(-3), [1, 1, 2], 'Yemen\'s conflict passes 1,000 in August');
    assert.equal(s.armedConflicts.at(-1), 3);
    assert.equal(s.deaths.at(-1), 505 + 33 + 900 + 125);
  });

  test('trends, place files with the conflicts spelled out, and unknown countries warn', () => {
    assert.equal(r.published.places.ye.trend, 'up');
    assert.equal(r.published.places.ua.trend, null);
    assert.equal(r.byPlace.ua.through, '2026-08');
    assert.equal(r.byPlace.ua.conflicts[0].name, 'Russia - Ukraine');
    assert.equal(r.byPlace.ru.partyTo[0].key, '1:13243');
    assert.deepEqual(r.warnings, ['[ucdp] countries not in config/sources/ucdp.json: Atlantis']);
  });

  test('a later version wins for an event it repeats', () => {
    const fix = version('26.0.9', '2026-09', [[versions.at(-1).events.find(e => e[2] === 70)[0], '2026-08-05', 70, '', '2:70', 20]]);
    const again = conflictSignals('ucdp', { fetchedAt: fix.fetchedAt, versions: [...versions, fix] }, config);
    assert.equal(again.through, '2026-09');
    assert.equal(again.published.places.mx.deaths12, 20);
  });
});
