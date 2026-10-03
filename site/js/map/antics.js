// What a mascot does when it is clicked: one small act per click, picked at random (it wiggles
// a paw, twitches its nose, lets its glasses slip and puts them back, smiles, hops). An act
// always plays to its end: a click while one is playing is dropped, not queued. Pure: the
// character's file (mascot.js) shows the act as `data-antic` on its drawing and gives the timer.
//
// The acts belong to no one character. Any drawing with these groups can play them (the CSS is
// `.mascot[data-antic=…]` in styles.css): mascot-bob (the whole body), mascot-arm, mascot-nose,
// mascot-glasses, mascot-mouth and mascot-grin (the wide smile, hidden until it smiles),
// mascot-eye. A character without one of them (no glasses) leaves that act out of its list.

// Each act and how long it plays (ms): as long as its animation in styles.css, 2 to 3 seconds.
export const ANTICS = [
  { name: 'paw', ms: 2200 },
  { name: 'nose', ms: 2000 },
  { name: 'glasses', ms: 2800 },
  { name: 'smile', ms: 2400 },
  { name: 'hop', ms: 2000 },
];

/**
 * @param opts.apply(name|null)  show this act; null when it is over
 * @param opts.antics            the acts to pick from
 * @param opts.random            0..1 (injectable for tests); the same act never plays twice in a row
 * @param opts.timer, opts.clear setTimeout and clearTimeout (injectable for tests)
 */
export function createAntics({ apply, antics = ANTICS, random = Math.random, timer = setTimeout, clear = clearTimeout }) {
  let last = null;
  let playing = null;
  let handle = null;
  return {
    /** Play an act. False, and nothing happens, while one is still playing. */
    play() {
      if (playing) return false;
      const choices = antics.length > 1 ? antics.filter(a => a.name !== last) : antics;
      const act = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
      last = playing = act.name;
      apply(act.name);
      handle = timer(() => { playing = null; handle = null; apply(null); }, act.ms);
      return true;
    },
    /** The act that is playing, or null. */
    get playing() { return playing; },
    stop() { clear(handle); playing = null; handle = null; },
  };
}
