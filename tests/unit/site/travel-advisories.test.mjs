import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { indexByPlace, isRecent, latestChange, recentRecords, pulseOpacity, noAdvisoryReason, titleSize } from '../../../site/js/datasets/travel-advisories/logic.js';
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

describe('recency: only level changes count', () => {
  const change = (date, from, to) => ({ date, from, to, up: to > from });
  const raised = { level: 3, updated: '2026-09-25', levelChanges: [change('2026-09-25', 2, 3)] };
  const lowered = { level: 1, updated: '2026-09-20', levelChanges: [change('2026-09-20', 2, 1)] };
  const textOnly = { level: 2, updated: '2026-09-26' };   // updated yesterday, same level
  const oldChange = { level: 2, updated: '2026-09-26', levelChanges: [change('2026-01-10', 1, 2)] };

  test('a raised or lowered level within the window is recent', () => {
    assert.equal(isRecent(raised, 30, ageDays), true);
    assert.equal(isRecent(lowered, 30, ageDays), true);
  });
  test('an update without a level change never is, however fresh', () => assert.equal(isRecent(textOnly, 30, ageDays), false));
  test('a fresh update does not revive an old level change', () => assert.equal(isRecent(oldChange, 90, ageDays), false));
  test('nothing is recent when highlighting is off', () => assert.equal(isRecent(raised, 0, ageDays), false));
  test('a missing record is not recent', () => assert.equal(isRecent(undefined, 30, ageDays), false));
  test('latestChange is the newest level change, or null', () => {
    assert.deepEqual(latestChange({ levelChanges: [change('2026-09-25', 2, 3), change('2026-01-01', 1, 2)] }).date, '2026-09-25');
    assert.equal(latestChange(textOnly), null);
  });

  test('the feed lists level changes, newest first (then highest level), filtered by level', () => {
    const a = { title: 'A', level: 2, levelChanges: [change('2026-09-20', 1, 2)] };
    const b = { title: 'B', level: 4, levelChanges: [change('2026-09-26', 3, 4)] };
    const c = { title: 'C', level: 1, levelChanges: [change('2026-09-26', 2, 1)] };
    const d = { title: 'D', level: 3, updated: '2026-09-27' };
    assert.deepEqual(recentRecords([a, b, c, d], { windowDays: 30, levels: [1, 2, 3, 4], ageDays }).map(r => r.title), ['B', 'C', 'A']);
    assert.deepEqual(recentRecords([a, b, c, d], { windowDays: 30, levels: [2], ageDays }).map(r => r.title), ['A']);
  });

  test('fresher changes pulse more strongly', () => {
    const at = (date) => ({ levelChanges: [change(date, 1, 2)] });
    assert.ok(pulseOpacity(at('2026-09-27'), 30, ageDays) > pulseOpacity(at('2026-09-01'), 30, ageDays));
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
