// GDELT news activity: the zip reader, the daily counts store, the unusual-activity rules and
// the daily-file parser.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { zip } from './zip-helper.mjs';
import { unzipFirst } from '../../../scripts/lib/zip.mjs';
import { addDay, addDays, dayIndex, emptyCounts, windowSum } from '../../../scripts/lib/counts.mjs';
import { poissonTail, assess, assessAll, changeRatio, rank } from '../../../scripts/lib/anomaly.mjs';
import { countEvents, fileDay } from '../../../scripts/providers/gdelt/parse.mjs';

const CONFIG = JSON.parse(readFileSync(new URL('../../../config/sources/gdelt.json', import.meta.url), 'utf8'));
// 59 real lines of a daily file (Sep 27, 2026): protests in France, fights in Ethiopia, assaults
// in the U.S., mass violence in Syria, protests without a location, fights at sea, other events.
const CSV = readFileSync(new URL('../../fixtures/gdelt-events.csv', import.meta.url), 'utf8');

describe('unzipFirst', () => {
  test('reads the one file of a deflated or stored archive', () => {
    const data = Buffer.from('a\tb\n'.repeat(1000));
    assert.deepEqual(unzipFirst(zip('20260927.export.CSV', data)), { name: '20260927.export.CSV', data });
    assert.deepEqual(unzipFirst(zip('x.txt', data, { deflate: false })).data, data);
  });
  test('rejects what is not a zip archive', () => {
    assert.throws(() => unzipFirst(Buffer.from('<html>not found</html>')), /no end record/);
    assert.throws(() => unzipFirst(Buffer.alloc(5)), /too short/);
    assert.throws(() => unzipFirst('text'), /too short/);
    const bad = zip('x', Buffer.from('x'));
    bad.writeUInt16LE(99, 8 + 30 + 1 + deflateRawSync(Buffer.from('x')).length + 2);   // central directory: method 99
    assert.throws(() => unzipFirst(bad), /Unsupported zip compression method 99/);
  });
});

describe('daily counts', () => {
  const opts = { historyDays: 400 };
  test('adds days one by one, with a zero for places and series missing that day', () => {
    let d = addDay(emptyCounts(), '2026-09-01', { fr: { protest: 3 } }, opts);
    d = addDay(d, '2026-09-02', { fr: { violence: 1 }, et: { protest: 2 } }, opts);
    assert.deepEqual(d, { first: '2026-09-01', last: '2026-09-02', gaps: [], series: { fr: { protest: [3, 0], violence: [0, 1] }, et: { protest: [0, 2], violence: [0, 0] } } });
  });
  test('a day without data, or a skipped day, is a gap, left out of windows', () => {
    let d = addDay(emptyCounts(), '2026-09-01', { fr: { protest: 3 } }, opts);
    d = addDay(d, '2026-09-02', null, opts);
    d = addDay(d, '2026-09-04', { fr: { protest: 5 } }, opts);
    assert.deepEqual(d.gaps, ['2026-09-02', '2026-09-03']);
    assert.deepEqual(d.series.fr.protest, [3, 0, 0, 5]);
    assert.deepEqual(windowSum(d, 'fr', 'protest', '2026-09-04', 7), { sum: 8, days: 2 });
    assert.deepEqual(windowSum(d, 'xx', 'protest', '2026-09-04', 2), { sum: 0, days: 1 });
    assert.throws(() => addDay(d, '2026-09-04', {}, opts), /not after/);
  });
  test('keeps the last historyDays days', () => {
    let d = emptyCounts();
    for (let i = 0; i < 5; i++) d = addDay(d, addDays('2026-09-01', i), { fr: { protest: i } }, { historyDays: 3 });
    assert.deepEqual([d.first, d.last, d.series.fr.protest], ['2026-09-03', '2026-09-05', [2, 3, 4]]);
    assert.equal(dayIndex('2026-09-01', '2026-09-05'), 4);
  });
});

describe('unusual activity', () => {
  const R = CONFIG.anomaly;
  test('Poisson tail probabilities, exact for small means and approximate for large ones', () => {
    assert.equal(poissonTail(0, 3), 1);
    assert.ok(Math.abs(poissonTail(1, 1) - (1 - Math.exp(-1))) < 1e-12);
    assert.ok(Math.abs(poissonTail(10, 4) - 0.00813) < 1e-4);
    const big = poissonTail(7300, 7000);   // exp(-7000) underflows: the normal approximation
    assert.ok(big > 0.0001 && big < 0.001, String(big));
    assert.ok(poissonTail(7000, 7000) > 0.4);
  });
  test('0 → 1 or a few is not unusual; a small country\'s jump is', () => {
    assert.equal(assess({ count: 1, expected: 0 }, R).status, 'normal', 'no misleading 0 → 1');
    assert.equal(assess({ count: 4, expected: 0.5 }, R).status, 'normal', 'below the minimum count');
    assert.equal(assess({ count: 8, expected: 1.3 }, R).status, 'above');
    assert.equal(assess({ count: 18, expected: 4 }, R).status, 'far');
  });
  test('a country with high normal activity needs a real rise, not a few more', () => {
    assert.equal(assess({ count: 60, expected: 50 }, R).status, 'normal');
    assert.equal(assess({ count: 120, expected: 50 }, R).status, 'above');
    assert.equal(assess({ count: 250, expected: 50 }, R).status, 'far');
  });
  test('a status holds while the ratio is at least half of the one that entered it', () => {
    assert.equal(assess({ count: 110, expected: 50 }, R, 'far').status, 'far', 'ratio 2.2 >= 4/2');
    assert.equal(assess({ count: 80, expected: 50 }, R, 'far').status, 'above', 'ratio 1.6: far ends, above holds');
    assert.equal(assess({ count: 70, expected: 50 }, R, 'above').status, 'above');
    assert.equal(assess({ count: 55, expected: 50 }, R, 'above').status, 'normal', 'no longer unlikely by chance');
    assert.deepEqual(['normal', 'above', 'far', undefined].map(rank), [0, 1, 2, 0]);
  });
  test('a percentage only from an expected count of 2', () => {
    assert.equal(changeRatio(18, 4), 350);
    assert.equal(changeRatio(12, 1), null);
  });
  test('assesses every place at the counts\' last day, after a baseline of about 12 weeks', () => {
    let d = emptyCounts();
    for (let i = 0; i < 91; i++) d = addDay(d, addDays('2026-06-29', i), { fr: { protest: i >= 84 ? 12 : 1 }, et: { protest: 3 } }, { historyDays: 400 });
    const r = assessAll(d, R);
    assert.equal(r.through, '2026-09-27');
    assert.equal(r.learning, false);
    assert.deepEqual(r.places.fr.protest, { status: 'far', count: 84, expected: 7, });
    assert.equal(r.places.et.protest.status, 'normal');
    let young = emptyCounts();
    for (let i = 0; i < 30; i++) young = addDay(young, addDays('2026-09-01', i), { fr: { protest: 1 } }, { historyDays: 400 });
    assert.deepEqual(assessAll(young, R), { through: '2026-09-30', learning: true, places: {} });
    assert.deepEqual(assessAll(emptyCounts(), R), { through: null, learning: true, places: {} });
  });
});

describe('countEvents on a real daily file', () => {
  test('counts protest and violence events per place, once each, by where they happened', () => {
    const r = countEvents(CSV, CONFIG);
    assert.equal(r.events, 59);
    assert.deepEqual(r.counts, { fr: { protest: 5 }, et: { violence: 6 }, us: { violence: 4 }, sy: { violence: 2 } });
    assert.equal(r.matched, 17);
    assert.deepEqual(r.unmapped, { OS: 2 }, 'at sea: no place');
  });
  test('counts an event listed twice once', () => {
    const first = CSV.split('\n').find(l => l.split('\t')[28] === '14');
    assert.equal(countEvents(`${CSV}${first}\n`, CONFIG).counts.fr.protest, 5);
  });
  test('rejects a file of another format', () => {
    assert.throws(() => countEvents('<html>\n<body>moved</body>\n', CONFIG), /not in the expected format/);
    assert.throws(() => countEvents('', CONFIG), /not in the expected format/);
  });
  test('names the daily file by its day', () => assert.equal(fileDay('2026-09-27'), '20260927'));
});
