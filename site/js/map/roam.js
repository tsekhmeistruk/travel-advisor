// How the mascot gets about (pure; mascot.js moves it): a way planned as stretches of land and
// sea with their times, where it is along the way, and when a press on it is a lift, not a click.

// Swimming home after it was dropped in the sea: slowly, and on foot at the same pace over land.
export const HOMEWARD = Object.freeze({ landSpeed: 130, seaSpeed: 130, min: 1200, max: 9000 });
// Sent to a country the visitor clicked: quickly on foot, slower in the boat (so the boat is seen).
export const QUICK = Object.freeze({ landSpeed: 340, seaSpeed: 150, min: 500, max: 7000 });
/** A stretch of sea shorter than this (px on screen) is stepped over: no boat for a strait. */
export const MIN_SEA_PX = 28;

/**
 * Plan a way along a straight line.
 * @param land  samples along the line, in order: true where it is over land
 * @param px    the length of the line on screen
 * @param pace  { landSpeed, seaSpeed } px a second, { min, max } ms for the whole way, minSea px
 * @returns { ms, legs: [{ land, from, to, ms }] }: the stretches in order, `from` and `to` shares
 *   of the line (0..1), their times scaled so the whole way is within min and max
 */
export function planTrip(land, px, { landSpeed, seaSpeed, min = 0, max = Infinity, minSea = MIN_SEA_PX }) {
  const n = land.length;
  if (!n || !(px > 0)) return { ms: min, legs: [] };
  const step = px / n;
  const runs = [];
  for (const here of land) {
    const last = runs.at(-1);
    if (last && last.land === here) last.n++; else runs.push({ land: here, n: 1 });
  }
  for (const run of runs) if (!run.land && run.n * step < minSea) run.land = true;
  const legs = [];
  let at = 0, sum = 0;
  for (const run of runs) {
    const share = run.n / n;
    const ms = ((run.n * step) / (run.land ? landSpeed : seaSpeed)) * 1000;
    const last = legs.at(-1);
    if (last && last.land === run.land) { last.to = at + share; last.ms += ms; } else legs.push({ land: run.land, from: at, to: at + share, ms });
    at += share;
    sum += ms;
  }
  legs.at(-1).to = 1;
  const total = Math.max(min, Math.min(max, sum));
  for (const leg of legs) leg.ms *= total / sum;
  return { ms: Math.round(total), legs };
}

/** Where it is on a planned way after t ms: { f: its share of the line, land: on foot there or not, done }. */
export function tripAt(plan, t) {
  let rest = Math.max(0, t);
  for (const leg of plan.legs) {
    if (rest < leg.ms) return { f: leg.from + (leg.to - leg.from) * (rest / leg.ms), land: leg.land, done: false };
    rest -= leg.ms;
  }
  return { f: 1, land: plan.legs.at(-1)?.land ?? true, done: true };
}

/** The point a share f (0..1, clamped) of the way from one point to another. */
export function along(from, to, f) {
  const t = Math.max(0, Math.min(1, f));
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

/** Past this many px between press and release, the press was a drag, not a click. */
export const DRAG_PX = 5;
export const isDrag = (dx, dy, limit = DRAG_PX) => Math.hypot(dx, dy) > limit;
/** A press held this long without moving lifts it too (ms). */
export const HOLD_MS = 220;
