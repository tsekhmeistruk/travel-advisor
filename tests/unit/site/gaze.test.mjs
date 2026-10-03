// Where the capybara in Canada looks (site/js/map/gaze.js).

import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { gazeToward, createGaze, EAST, USER, IDLE_MS, GLANCE_MS } from '../../../site/js/map/gaze.js';

describe('gazeToward', () => {
  test('points from the mascot to the target, in screen axes (y down)', () => {
    assert.deepEqual(gazeToward([100, 100], [200, 100]), { look: 'place', x: 1, y: 0 });
    // South-west, like the U.S. from Canada: down and to the left.
    assert.deepEqual(gazeToward([100, 100], [70, 140]), { look: 'place', x: -0.6, y: 0.8 });
    // Straight up: no -0 in x.
    assert.ok(Object.is(gazeToward([100, 100], [100, 0]).x, 0));
  });
  test('a target on the mascot itself is looked at straight on', () => {
    assert.equal(gazeToward([100, 100], [100.5, 100]), USER);
    assert.equal(gazeToward([100, 100], [NaN, 100]), USER);
  });
});

describe('createGaze', () => {
  let seen, gaze;
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
    seen = [];
    gaze = createGaze({ apply: (g) => seen.push(g.look) });
  });
  afterEach(() => { gaze.stop(); mock.timers.reset(); });

  test('looks east until something is chosen', () => {
    assert.deepEqual(seen, ['east']);
    assert.equal(gaze.gaze(), EAST);
  });

  test('turns to a chosen place, and back east when the choice is cleared', () => {
    const down = { look: 'place', x: -0.3, y: 0.95 };
    gaze.setTarget(down);
    assert.equal(gaze.gaze(), down);
    gaze.setTarget(null);
    assert.deepEqual(seen, ['east', 'place', 'east']);
  });

  test('after 15 s without a click or a key it looks at the visitor for a moment, then every 15 s', () => {
    mock.timers.tick(IDLE_MS - 1);
    assert.deepEqual(seen, ['east']);
    mock.timers.tick(1);
    assert.deepEqual(seen, ['east', 'user']);
    mock.timers.tick(GLANCE_MS);
    assert.deepEqual(seen, ['east', 'user', 'east']);
    mock.timers.tick(IDLE_MS - GLANCE_MS);   // 15 s after the first look
    assert.deepEqual(seen, ['east', 'user', 'east', 'user']);
  });

  test('a click or a key restarts the 15 s, and ends a look at the visitor at once', () => {
    mock.timers.tick(IDLE_MS - 1000);
    gaze.activity();
    mock.timers.tick(IDLE_MS - 1);
    assert.deepEqual(seen, ['east']);
    mock.timers.tick(1);
    assert.equal(gaze.gaze(), USER);
    gaze.activity();
    assert.equal(gaze.gaze(), EAST);
  });

  test('looks back at the chosen place, not east, after looking at the visitor', () => {
    const place = { look: 'place', x: 0.2, y: 0.98 };
    gaze.setTarget(place);
    mock.timers.tick(IDLE_MS);
    mock.timers.tick(GLANCE_MS);
    assert.deepEqual(seen, ['east', 'place', 'user', 'place']);
  });

  test('stop() ends the timers', () => {
    gaze.stop();
    mock.timers.tick(IDLE_MS * 3);
    assert.deepEqual(seen, ['east']);
  });
});
