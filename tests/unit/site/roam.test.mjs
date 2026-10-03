// The mascot's way home from the sea (site/js/map/roam.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tripMs, along, isDrag, SPEED, MIN_MS, MAX_MS, DRAG_PX } from '../../../site/js/map/roam.js';

describe('roam', () => {
  test('a trip takes its length at the swimming speed, but never a blink or a long wait', () => {
    assert.equal(tripMs(SPEED * 3), 3000);
    assert.equal(tripMs(10), MIN_MS);
    assert.equal(tripMs(100000), MAX_MS);
    assert.equal(tripMs(200, { speed: 100, min: 0, max: 5000 }), 2000);
  });
  test('along(): the point a share of the way, never before the start or past the end', () => {
    assert.deepEqual(along([0, 0], [10, 20], 0.5), [5, 10]);
    assert.deepEqual(along([0, 0], [10, 20], 0), [0, 0]);
    assert.deepEqual(along([0, 0], [10, 20], 1.7), [10, 20]);
    assert.deepEqual(along([4, 4], [10, 20], -1), [4, 4]);
  });
  test('a press that moves more than a few px is a drag, not a click', () => {
    assert.equal(isDrag(3, 3), false);
    assert.equal(isDrag(DRAG_PX, 1), true);
    assert.equal(isDrag(0, -6), true);
    assert.equal(isDrag(0, 0), false);
  });
});
