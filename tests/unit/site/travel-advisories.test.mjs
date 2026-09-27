import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { indexByPlace, isRecent, recentDate, recentRecords, pulseOpacity, noAdvisoryReason, titleSize } from '../../../site/js/datasets/travel-advisories/logic.js';
import { splitFeatures, SPLIT_SHAPE_NAMES } from '../../../site/js/map/splits.js';

// Ages relative to a fixed "today" of 2026-09-27.
const ageDays = (iso) => Math.round((Date.UTC(2026, 8, 27) - Date.parse(`${iso}T00:00:00Z`)) / 864e5);

describe('indexByPlace', () => {
  const records = [
    { title: 'Somalia', places: ['so'], covers: ['somaliland'] },
    { title: 'Israel and Palestine', places: ['il', 'gaza', 'west-bank'] },
    { title: 'Israel', places: ['il'] },
  ];
  const idx = indexByPlace(records);

  test('maps a record to its own place as direct', () => assert.deepEqual(idx.get('so'), { record: records[0], direct: true }));
  test('maps covered places as not direct', () => assert.equal(idx.get('somaliland').direct, false));
  test('maps each place of a multi-place record as not direct', () => assert.equal(idx.get('gaza').direct, false));
  test('a place\'s own record wins over a shared one', () => assert.equal(idx.get('il').record.title, 'Israel'));
});

describe('recency', () => {
  const real = { level: 2, updated: '2026-09-20' };
  const minor = { level: 2, updated: '2026-09-20', minorUpdate: true };
  const changed = { level: 3, updated: '2026-01-01', minorUpdate: true, levelChange: { date: '2026-09-25', from: 2, to: 3 } };
  const old = { level: 1, updated: '2026-01-01' };

  test('a real update within the window is recent', () => assert.equal(isRecent(real, 30, ageDays), true));
  test('a minor update never is', () => assert.equal(isRecent(minor, 30, ageDays), false));
  test('a level change within the window is, even if the update was minor', () => assert.equal(isRecent(changed, 30, ageDays), true));
  test('nothing is recent when highlighting is off', () => assert.equal(isRecent(real, 0, ageDays), false));
  test('an old update is not recent', () => assert.equal(isRecent(old, 90, ageDays), false));
  test('the recent date is the level change when it is in the window', () => assert.equal(recentDate(changed, 30, ageDays), '2026-09-25'));

  test('the feed is newest first, filtered by level', () => {
    const a = { title: 'A', level: 2, updated: '2026-09-20' };
    const b = { title: 'B', level: 4, updated: '2026-09-26' };
    const c = { title: 'C', level: 1, updated: '2026-09-26' };
    assert.deepEqual(recentRecords([a, b, c], { windowDays: 30, levels: [1, 2, 3, 4], ageDays }).map(r => r.title), ['B', 'C', 'A']);
    assert.deepEqual(recentRecords([a, b, c], { windowDays: 30, levels: [2], ageDays }).map(r => r.title), ['A']);
  });

  test('fresher changes pulse more strongly', () => {
    assert.ok(pulseOpacity({ updated: '2026-09-27' }, 30, ageDays) > pulseOpacity({ updated: '2026-09-01' }, 30, ageDays));
  });
});

test('noAdvisoryReason tells home, territories and the rest apart', () => {
  const data = { home: 'us', territories: ['pr'] };
  assert.equal(noAdvisoryReason('us', data), 'home');
  assert.equal(noAdvisoryReason('pr', data), 'territory');
  assert.equal(noAdvisoryReason('aq', data), 'none');
});

test('titleSize shrinks long names instead of wrapping', () => {
  assert.equal(titleSize('Chad'), '');
  assert.equal(titleSize('Saint Vincent and the Grenadines'), 'long');
  assert.equal(titleSize('South Georgia and the South Sandwich Islands'), 'xlong');
});

describe('map splits', () => {
  const square = (x, y) => [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]];
  test('splits a merged feature into its separate places and keeps the rest', () => {
    const france = { type: 'Feature', id: '250', properties: { name: 'France' }, geometry: { type: 'MultiPolygon', coordinates: [square(2, 46), square(-53, 4)] } };
    const out = splitFeatures([france]);
    assert.deepEqual(out.map(f => f.properties.name).sort(), ['France', 'French Guiana']);
  });
  test('lists every split shape name', () => {
    assert.ok(SPLIT_SHAPE_NAMES.includes('Gaza') && SPLIT_SHAPE_NAMES.includes('Canary Islands'));
  });
});
