// The conflict category (scripts/lib/conflict.mjs): merging UCDP versions, levels by deaths,
// the war count, trends, parties and sides, new and quiet conflicts, the month's dots. Small
// hand-made versions, plus real monthly series.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addMonths, monthsBack, governments, sideActors, bandLevel, trendOf, conflictSignals, STORED_FORMAT } from '../../../scripts/lib/conflict.mjs';

const CONFIG = JSON.parse(readFileSync(new URL('../../../config/sources/ucdp.json', import.meta.url), 'utf8'));
const COUNTRIES = { 369: 'Ukraine', 365: 'Russia (Soviet Union)', 666: 'Israel', 70: 'Mexico', 678: 'Yemen (North Yemen)', 625: 'Sudan', 999: 'Atlantis' };
const CONFLICTS = {
  '1:13243': { name: 'Russia - Ukraine' },
  '1:234': { name: 'Israel: Palestine' },
  '1:777': { name: 'XXX678' },
  '1:309': { name: 'Sudan: Government' },
  '2:70': { name: 'XXX70 - XXX70' },
};
const ACTORS = {
  57: 'Government of Russia (Soviet Union)', 61: 'Government of Ukraine', 121: 'Government of Israel', 209: 'Hamas', 208: 'PIJ',
  3714: 'XXX678', 3702: 'XXX70', 112: 'Government of Sudan', 8635: 'RSF', 9645: 'SFA', 114: 'Government of Iran',
  9865: 'Government of Israel, Government of United States of America',
};
// Who fights in each conflict, unless an event says otherwise.
const DYAD = { '1:13243': [57, 61], '1:234': [121, 209], '1:777': [3714, 3714], '1:309': [112, 8635], '2:70': [3702, 3702] };
let nextId = 1;
/** An event: [id, date, country, region, conflict, deaths, side A, side B, civilians, lat, lon, precision]. */
const ev = (date, countryId, key, deaths, { region = '', sides = DYAD[key], civilians = 0, point = [10.5, 20.25, 1] } = {}) =>
  [nextId++, date, countryId, region, key, deaths, ...sides, civilians, ...point];
const version = (v, month, events, conflicts = CONFLICTS) => ({ version: v, month, fetchedAt: `${month}-28T00:00:00.000Z`, format: STORED_FORMAT, countries: COUNTRIES, actors: ACTORS, conflicts, events });
const config = { ...CONFIG, seriesMonths: 15 };
/** One version per month of `months`, each with the events of its month. */
const monthly = (months, events) => months.map(m => version(`${m.slice(2, 4)}.0.${Number(m.slice(5))}`, m, events.filter(e => e[1].startsWith(m))));

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
  test('the actors on a side: governments one by one, any other name whole', () => {
    assert.deepEqual(sideActors('Government of Israel, Government of United States of America'), ['Government of Israel', 'Government of United States of America']);
    assert.deepEqual(sideActors('Government of Sudan'), ['Government of Sudan']);
    assert.deepEqual(sideActors('Jalisco Cartel New Generation, Sinaloa Cartel - Los Chapitos'), ['Jalisco Cartel New Generation, Sinaloa Cartel - Los Chapitos'], 'two cartels as one side (real UCDP name)');
    assert.deepEqual(sideActors('Government of Mali, Wagner'), ['Government of Mali, Wagner'], 'not only governments: kept whole');
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
  const steady = months.flatMap(m => [ev(`${m}-10`, 369, '1:13243', 500), ev(`${m}-11`, 365, '1:13243', 5, { point: [55.75, 37.62, 6] })]);
  const versions = [
    ...monthly(months.slice(0, -1), steady),
    version('26.0.8', '2026-08', [
      ...steady.filter(e => e[1].startsWith('2026-08')),
      ev('2026-08-02', 666, '1:234', 30, { region: 'Gaza Strip', civilians: 12, point: [31.5, 34.47, 2] }),
      ev('2026-08-03', 666, '1:234', 2, { region: 'West Bank', sides: [121, 208] }),
      ev('2026-08-04', 666, '1:234', 1, { region: 'Tel Aviv district', point: [null, null, 4] }),
      ev('2026-06-20', 678, '1:777', 400), ev('2026-08-20', 678, '1:777', 900),   // backdated, then a new month
      ev('2026-08-05', 70, '2:70', 120), ev('2026-08-06', 999, '2:70', 5),
      ev('2026-08-07', 70, '2:70', 0),   // no deaths: no dot
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

  test('state-based conflicts with 25+ deaths are listed; 1,000+ is a war; sides and parties come from the events', () => {
    const c = r.published.conflicts;
    assert.deepEqual(Object.keys(c), ['1:13243', '1:777', '1:234'], 'most deaths first; non-state conflicts are not listed');
    assert.deepEqual(c['1:13243'], {
      name: 'Russia - Ukraine',
      sides: { a: [{ name: 'Government of Russia (Soviet Union)', place: 'ru', deaths: 6060 }], b: [{ name: 'Government of Ukraine', place: 'ua', deaths: 6060 }] },
      deaths12: 6060, civilians12: 0, last: 505, months: Array(12).fill(505), first: '2025-07',
      war: true, places: ['ua', 'ru'], parties: ['ru', 'ua'],
    });
    assert.equal(c['1:777'].name, null, 'not named yet: the sides say who');
    assert.deepEqual(c['1:777'].sides, { a: [{ name: null, place: 'ye', deaths: 1300 }], b: [{ name: null, place: 'ye', deaths: 1300 }] }, 'XXX678: the government of country 678');
    assert.deepEqual(c['1:777'].parties, ['ye']);
    assert.equal(c['1:234'].war, false);
    assert.deepEqual(c['1:234'].sides.b, [{ name: 'Hamas', deaths: 31 }, { name: 'PIJ', deaths: 2 }], 'every group the government fought, by deaths');
    assert.equal(c['1:234'].civilians12, 12);
    assert.deepEqual(c['1:234'].places, ['gaza', 'west-bank', 'il']);
    assert.deepEqual(r.published.places.il, { deaths12: 1, months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], byType: { state: 1, nonState: 0, oneSided: 0 }, trend: null, conflicts: ['1:234'], partyTo: ['1:234'] });
    assert.deepEqual(r.published.places.ru.partyTo, ['1:13243']);
  });

  test('new conflicts: first seen in the 12 months, with data before them', () => {
    assert.deepEqual(r.published.new, ['1:777', '1:234']);
    assert.deepEqual(r.published.quiet, [], 'not 15 months of data yet: no conflict can be called quiet');
  });

  test('the war count per month, where 12 months of data are behind it', () => {
    const s = r.published.series;
    assert.equal(s.months.length, 14, 'from the first month of data');
    assert.deepEqual(s.wars.slice(0, 3), [null, null, null]);
    assert.deepEqual(s.wars.slice(-3), [1, 1, 2], 'Yemen\'s conflict passes 1,000 in August');
    assert.equal(s.armedConflicts.at(-1), 3);
    assert.equal(s.deaths.at(-1), 505 + 33 + 900 + 125);
  });

  test('the month\'s dots: events of the latest month with deaths and a point, most deaths first', () => {
    const e = r.events;
    assert.equal(e.through, '2026-08');
    assert.deepEqual(e.events.map(d => [d[2], d[7]]), [[900, 'ye'], [500, 'ua'], [120, 'mx'], [30, 'gaza'], [5, null], [2, 'west-bank']],
      'not: Russia (only the country, precision 6), Tel Aviv (no point), June (another month), the event without deaths');
    assert.deepEqual(e.events[3], [31.5, 34.47, 30, '2026-08-02', '1:234', 121, 209, 'gaza', 'Gaza Strip']);
    assert.deepEqual(e.conflicts, { '1:13243': 'Russia - Ukraine', '1:234': 'Israel: Palestine', '1:777': null, '2:70': null });
    assert.deepEqual(Object.keys(e.actors).map(Number), [57, 61, 121, 208, 209, 3702, 3714]);
    assert.equal(e.actors[209], 'Hamas');
  });

  test('trends, place files with the conflicts spelled out, and unknown countries warn', () => {
    assert.equal(r.published.places.ye.trend, 'up');
    assert.equal(r.published.places.ua.trend, null);
    assert.equal(r.byPlace.ua.through, '2026-08');
    assert.equal(r.byPlace.ua.conflicts[0].name, 'Russia - Ukraine');
    assert.deepEqual(r.byPlace.ua.conflicts[0].sides.b[0].place, 'ua');
    assert.equal(r.byPlace.ru.partyTo[0].key, '1:13243');
    assert.deepEqual(r.warnings, ['[ucdp] countries not in config/sources/ucdp.json: Atlantis']);
  });

  test('a later version wins for an event it repeats', () => {
    const fix = version('26.0.9', '2026-09', [[versions.at(-1).events.find(e => e[2] === 70)[0], '2026-08-05', 70, '', '2:70', 20, 3702, 3702, 0, 19.4, -99.1, 1]]);
    const again = conflictSignals('ucdp', { fetchedAt: fix.fetchedAt, versions: [...versions, fix] }, config);
    assert.equal(again.through, '2026-09');
    assert.equal(again.published.places.mx.deaths12, 20);
  });

  test('a version stored in an older format is refused, not misread', () => {
    const old = { ...versions[0], format: undefined };
    assert.throws(() => conflictSignals('ucdp', { fetchedAt: versions.at(-1).fetchedAt, versions: [old, ...versions.slice(1)] }, config),
      /versions stored in an older format: 25\.0\.7; run npm run fetch ucdp/);
  });
});

describe('sides of a war with several dyads, and quiet conflicts', () => {
  // 20 months (2025-01 to 2026-08): Sudan's government fights the RSF, then the SFA (UCDP recoded
  // the RSF-led alliance in 2025); Iran fights Israel and the United States on one side; a conflict
  // in Ukraine stops after May 2026.
  const months = monthsBack('2026-08', 20);
  const events = [
    ...months.map(m => ev(`${m}-05`, 625, '1:309', m < '2026-01' ? 100 : 10, { sides: m < '2026-01' ? [112, 8635] : [112, 9645], civilians: 3 })),
    ev('2026-03-01', 666, '1:16905', 300, { sides: [114, 9865] }),
    ...months.filter(m => m <= '2026-05').map(m => ev(`${m}-09`, 369, '1:13243', 20)),
  ];
  const conflicts = { ...CONFLICTS, '1:16905': { name: 'Iran - Israel, United States of America' } };
  const versions = monthly(months, events).map(v => ({ ...v, conflicts, countries: { ...COUNTRIES, 2: 'United States of America' } }));
  const r = conflictSignals('ucdp', { fetchedAt: versions.at(-1).fetchedAt, versions }, config);

  test('every opponent in the window, by deaths; governments on one side split, each with its place', () => {
    const sudan = r.published.conflicts['1:309'];
    assert.deepEqual(sudan.sides, {
      a: [{ name: 'Government of Sudan', place: 'sd', deaths: 480 }],
      b: [{ name: 'RSF', deaths: 400 }, { name: 'SFA', deaths: 80 }],
    }, 'Sep 2025 to Aug 2026: 4 months of the RSF at 100, 8 of the SFA at 10');
    assert.equal(sudan.civilians12, 36);
    assert.deepEqual(sudan.months, [100, 100, 100, 100, 10, 10, 10, 10, 10, 10, 10, 10]);
    assert.equal(sudan.first, '2025-01');
    const iran = r.published.conflicts['1:16905'];
    assert.deepEqual(iran.sides.b, [{ name: 'Government of Israel', place: 'il', deaths: 300 }, { name: 'Government of United States of America', place: 'us', deaths: 300 }]);
    assert.deepEqual(iran.parties, ['il', 'ir', 'us']);
    assert.deepEqual(r.published.new, ['1:16905']);
  });

  test('quiet: 100+ deaths in the 12 months before the last 3, and none since', () => {
    assert.deepEqual(r.published.quiet, [
      { key: '1:16905', name: 'Iran - Israel, United States of America', deaths: 300, lastDeaths: '2026-03', parties: ['il', 'ir', 'us'] },
      { key: '1:13243', name: 'Russia - Ukraine', deaths: 240, lastDeaths: '2026-05', parties: ['ru', 'ua'] },
    ], 'most deaths first; Sudan goes on');
  });
});
