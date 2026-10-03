// The mascot's way home after it is dropped in the sea (pure; mascot.js moves it): how long the
// trip takes, and where it is along it.

export const SPEED = 130;                 // px on screen per second
export const MIN_MS = 1200, MAX_MS = 9000;

/** How long a trip of this many px on screen takes: at SPEED, but never a blink or a long wait. */
export function tripMs(px, { speed = SPEED, min = MIN_MS, max = MAX_MS } = {}) {
  return Math.round(Math.max(min, Math.min(max, (px / speed) * 1000)));
}

/** The point a share f (0..1, clamped) of the way from one point to another. */
export function along(from, to, f) {
  const t = Math.max(0, Math.min(1, f));
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

/** Past this many px between press and release, the press was a drag, not a click. */
export const DRAG_PX = 5;
export const isDrag = (dx, dy, limit = DRAG_PX) => Math.hypot(dx, dy) > limit;
