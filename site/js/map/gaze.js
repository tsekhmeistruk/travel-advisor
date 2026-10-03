// Where the map's mascot (the capybara in Canada, mascot.js) looks. Pure: no DOM.
//
//   - most of the time it looks east;
//   - with a place chosen, it looks towards it (the U.S. or South America: down);
//   - after 15 seconds without a click or a key, it looks at the visitor for a moment, and
//     again every 15 seconds while nothing happens.
//
// A gaze is { look: 'east' | 'place' | 'user', x, y }: x and y in -1..1, screen axes (y down).

export const IDLE_MS = 15000;    // no click or key for this long: a look at the visitor
export const GLANCE_MS = 2600;   // how long that look lasts

export const EAST = Object.freeze({ look: 'east', x: 1, y: 0 });
export const USER = Object.freeze({ look: 'user', x: 0, y: 0 });

/**
 * The gaze from one point to another (projected map coordinates, y down). A target too close
 * to tell (the mascot's own spot) is looked at straight on.
 */
export function gazeToward(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const d = Math.hypot(dx, dy);
  if (!(d >= 1)) return USER;
  return { look: 'place', x: round(dx / d), y: round(dy / d) };
}

const round = (v) => Math.round(v * 100) / 100 || 0;   // no -0

/**
 * Drives the gaze over time. apply(gaze) is called on every change; timers is injectable
 * (setTimeout and clearTimeout) for tests.
 * @returns {{ setTarget(gaze|null), activity(), stop(), gaze() }}
 */
export function createGaze({ apply, timers = globalThis, idleMs = IDLE_MS, glanceMs = GLANCE_MS }) {
  let target = null;      // a place's gaze, or null: east
  let glancing = false;
  let timer = null;
  let current = null;

  const show = () => {
    const next = glancing ? USER : target ?? EAST;
    if (next === current) return;
    current = next;
    apply(next);
  };
  const schedule = (fn, ms) => { timers.clearTimeout(timer); timer = timers.setTimeout(fn, ms); };
  const glance = () => {
    glancing = true;
    show();
    schedule(() => { glancing = false; show(); schedule(glance, idleMs - glanceMs); }, glanceMs);
  };
  const activity = () => {
    glancing = false;
    show();
    schedule(glance, idleMs);
  };

  activity();
  return {
    setTarget(gaze) { target = gaze; activity(); },
    activity,
    stop() { timers.clearTimeout(timer); timer = null; },
    gaze: () => current,
  };
}
