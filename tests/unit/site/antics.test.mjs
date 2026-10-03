// What a mascot does when clicked (site/js/map/antics.js): one act per click, picked at random,
// each played to its end.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createAntics, ANTICS } from '../../../site/js/map/antics.js';

/** A timer the test fires by hand. */
function fakeTimer() {
  const pending = [];
  return {
    timer: (fn, ms) => { const h = { fn, ms }; pending.push(h); return h; },
    clear: (h) => { const i = pending.indexOf(h); if (i >= 0) pending.splice(i, 1); },
    fire: () => pending.shift().fn(),
    pending,
  };
}
/** rolls: what random() gives, in turn (0 picks the first act it may, 0.99 the last). */
const setup = (rolls = [0], antics = [{ name: 'a', ms: 100 }, { name: 'b', ms: 5000 }, { name: 'c', ms: 2000 }]) => {
  const shown = [];
  const t = fakeTimer();
  let i = 0;
  const random = () => rolls[i++ % rolls.length];
  return { shown, t, antics: createAntics({ apply: (name) => shown.push(name), antics, random, timer: t.timer, clear: t.clear }) };
};

describe('createAntics', () => {
  test('a click plays the next act for its own time, then it is over', () => {
    const { antics, shown, t } = setup();
    assert.equal(antics.play(), true);
    assert.deepEqual([shown, antics.playing, t.pending[0].ms], [['a'], 'a', 100]);
    t.fire();
    assert.deepEqual([shown, antics.playing], [['a', null], null]);
  });

  test('clicks while an act plays are dropped: it is not cut short, and none waits its turn', () => {
    const { antics, shown, t } = setup();
    antics.play();
    t.fire();
    antics.play();   // "b", 5 seconds (not "a" again)
    assert.equal(t.pending[0].ms, 5000);
    assert.deepEqual([antics.play(), antics.play(), antics.play()], [false, false, false]);
    assert.deepEqual(shown, ['a', null, 'b'], 'still the same act');
    assert.equal(t.pending.length, 1, 'one timer: its end is not put off');
    t.fire();
    assert.deepEqual([shown.at(-1), antics.playing, t.pending.length], [null, null, 0], 'over, and nothing queued');
    assert.equal(antics.play(), true, 'the next click plays again');
  });

  test('each click picks an act at random, never the one just played', () => {
    const { antics, shown, t } = setup([0.99, 0.99, 0, 0, 0.5]);
    for (let i = 0; i < 5; i++) { antics.play(); t.fire(); }
    // "c" (the last of three), then the last of the other two, the first of the other two, …
    assert.deepEqual(shown.filter(Boolean), ['c', 'b', 'a', 'b', 'c']);
    const dice = createAntics({ apply: () => {}, timer: () => 0, clear: () => {} });
    assert.equal(dice.play(), true, 'Math.random by default');
  });

  test('a character with one act plays it every time', () => {
    const { antics, shown, t } = setup([0.7], [{ name: 'only', ms: 10 }]);
    for (let i = 0; i < 3; i++) { antics.play(); t.fire(); }
    assert.deepEqual(shown.filter(Boolean), ['only', 'only', 'only']);
  });

  test('stop() ends the act and its timer', () => {
    const { antics, t } = setup();
    antics.play();
    antics.stop();
    assert.deepEqual([antics.playing, t.pending.length], [null, 0]);
  });

  test('the real acts: five of 2 to 3 seconds, and the walk to the U.S. and back, under 6', () => {
    assert.deepEqual(ANTICS.map(a => a.name), ['paw', 'nose', 'glasses', 'smile', 'hop', 'walk']);
    assert.ok(ANTICS.filter(a => a.name !== 'walk').every(a => a.ms >= 2000 && a.ms <= 3000));
    const walk = ANTICS.find(a => a.name === 'walk');
    assert.ok(walk.ms > 3000 && walk.ms <= 6000, `${walk.ms} ms`);
  });
});
