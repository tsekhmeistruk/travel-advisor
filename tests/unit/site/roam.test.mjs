// How the mascot gets about (site/js/map/roam.js): a way planned as stretches of land and sea.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planTrip, tripAt, along, isDrag, wayLength, REF_SCALE, QUICK, HOMEWARD, MIN_SEA_PX, DRAG_PX, HOLD_MS } from '../../../site/js/map/roam.js';

const L = true, S = false;
const PACE = { landSpeed: 100, seaSpeed: 50, minSea: 20 };

describe('planTrip', () => {
  test('stretches of land and sea in order, each at its own pace', () => {
    // 10 samples over 200px: 80px of land, 80px of sea, 40px of land.
    const plan = planTrip([L, L, L, L, S, S, S, S, L, L], 200, PACE);
    assert.deepEqual(plan.legs.map(l => [l.land, Math.round(l.from * 10), Math.round(l.to * 10), Math.round(l.ms)]), [[true, 0, 4, 800], [false, 4, 8, 1600], [true, 8, 10, 400]]);
    assert.equal(plan.ms, 2800);
  });
  test('a strait is stepped over: a short stretch of sea is walked, and joins the land around it', () => {
    const plan = planTrip([L, L, S, L, L], 50, PACE);   // 10px of sea
    assert.deepEqual(plan.legs.map(l => [l.land, l.from, l.to]), [[true, 0, 1]]);
    assert.equal(plan.ms, 500);
    assert.equal(planTrip([L, S, S, S, L], 50, PACE).legs.length, 3, '30px of sea: a boat');
  });
  test('the whole way is never a blink or a long wait: the stretches are scaled together', () => {
    const quick = planTrip([L, S, S, L], 400, { ...PACE, max: 2000 });   // 100 land, 200 sea, 100 land: 6 s
    assert.equal(quick.ms, 2000);
    assert.deepEqual(quick.legs.map(l => Math.round(l.ms)), [333, 1333, 333]);
    assert.equal(planTrip([L], 10, { ...PACE, min: 500 }).ms, 500);
  });
  test('no way at all is its least time, with nothing to walk', () => {
    assert.deepEqual(planTrip([], 0, { ...PACE, min: 300 }), { ms: 300, legs: [] });
    assert.deepEqual(planTrip([L], 0, PACE), { ms: 0, legs: [] });
  });
  test('the paces: sent to a clicked country it is quick, and slower in the boat; swimming home is slow', () => {
    assert.ok(QUICK.landSpeed > QUICK.seaSpeed && QUICK.landSpeed > HOMEWARD.landSpeed * 2);
    assert.ok(QUICK.max <= 7000 && HOMEWARD.max <= 9000);
    assert.ok(MIN_SEA_PX / QUICK.seaSpeed >= 0.15, 'a boat is on the water long enough to be seen');
  });
});

describe('wayLength', () => {
  test('a way is as long as on the reference map, whatever the screen: the zoom plays no part', () => {
    assert.equal(wayLength(100, REF_SCALE), 100);
    assert.equal(wayLength(50, REF_SCALE / 2), 100, 'a phone: the same two points, half as far apart on its map');
    assert.equal(wayLength(100, 0), 0);
    // So the time between two points is the same on both.
    const desktop = planTrip([true], wayLength(680, REF_SCALE), QUICK).ms, phone = planTrip([true], wayLength(340, REF_SCALE / 2), QUICK).ms;
    assert.equal(desktop, phone);
    assert.equal(desktop, 2000);
  });
});

describe('tripAt', () => {
  const plan = planTrip([L, L, L, L, S, S, S, S, L, L], 200, PACE);
  test('where it is after a time: its share of the line, and whether on land', () => {
    assert.deepEqual(tripAt(plan, 0), { f: 0, land: true, done: false });
    assert.deepEqual(tripAt(plan, 400), { f: 0.2, land: true, done: false });
    const sea = tripAt(plan, 1600);
    assert.deepEqual([Math.round(sea.f * 100), sea.land, sea.done], [60, false, false]);
    assert.deepEqual(tripAt(plan, 2800), { f: 1, land: true, done: true });
    assert.deepEqual(tripAt(plan, 99999), { f: 1, land: true, done: true });
    assert.deepEqual(tripAt(plan, -5), { f: 0, land: true, done: false });
  });
  test('a way with nothing to walk is done at once', () => {
    assert.deepEqual(tripAt({ ms: 0, legs: [] }, 0), { f: 1, land: true, done: true });
  });
});

describe('along and isDrag', () => {
  test('along(): the point a share of the way, never before the start or past the end', () => {
    assert.deepEqual(along([0, 0], [10, 20], 0.5), [5, 10]);
    assert.deepEqual(along([0, 0], [10, 20], 0), [0, 0]);
    assert.deepEqual(along([0, 0], [10, 20], 1.7), [10, 20]);
    assert.deepEqual(along([4, 4], [10, 20], -1), [4, 4]);
  });
  test('a press that moves more than a few px is a drag; held a moment, it is a lift', () => {
    assert.equal(isDrag(3, 3), false);
    assert.equal(isDrag(DRAG_PX, 1), true);
    assert.equal(isDrag(0, -6), true);
    assert.equal(isDrag(0, 0), false);
    assert.ok(HOLD_MS >= 150 && HOLD_MS <= 400, 'longer than a click, shorter than a wait');
  });
});
