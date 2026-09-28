// Unusual activity (pure): is this week's count much higher than this place's own normal, and
// unlikely to be chance? The rules (docs/architecture.md, "Unusual activity"):
//   expected   the baseline's count, scaled to the window's days (12 weeks → 1 week)
//   chance     P(X >= count) for a Poisson count with mean max(expected, 0.5)
//   above      count >= minCount, count − expected >= minExcess, ratio >= minRatio, p < maxP
//   far        count >= minCount, ratio >= minRatio, p < maxP (stricter values)
//   stay       a status is kept while the ratio is at least half of the one that entered it
//              and p <= stay.maxP, so it doesn't flicker around a threshold
// Percentages are only meaningful from an expected count of 2 (see changeRatio).

import { windowSum, addDays } from './counts.mjs';

const RANK = { normal: 0, above: 1, far: 2 };
export const MIN_EXPECTED_FOR_PERCENT = 2;

/** P(X >= c) for X ~ Poisson(lambda); a normal approximation for large lambda (no underflow). */
export function poissonTail(c, lambda) {
  if (c <= 0) return 1;
  if (lambda > 100) {
    const z = (c - 0.5 - lambda) / Math.sqrt(lambda);
    return 0.5 * erfc(z / Math.SQRT2);
  }
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let k = 1; k < c; k++) { term *= lambda / k; cdf += term; }
  return Math.max(0, 1 - cdf);
}

// Complementary error function (Abramowitz and Stegun 7.1.26, error < 1.5e-7).
function erfc(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return x >= 0 ? y : 2 - y;
}

/**
 * The status of one count against its expected value, given the previous status.
 * @returns { status: 'normal' | 'above' | 'far', p, ratio }
 */
export function assess({ count, expected }, rules, previous = 'normal') {
  const lambda = Math.max(expected, 0.5);
  const p = poissonTail(count, lambda);
  const ratio = count / lambda;
  const { above, far, stay } = rules;
  const meets = {
    far: count >= far.minCount && ratio >= far.minRatio && p < far.maxP,
    above: count >= above.minCount && count - expected >= above.minExcess && ratio >= above.minRatio && p < above.maxP,
  };
  const holds = {
    far: ratio >= far.minRatio / 2 && p <= stay.maxP,
    above: ratio >= above.minRatio / 2 && p <= stay.maxP,
  };
  let status = meets.far ? 'far' : meets.above ? 'above' : 'normal';
  for (const s of ['far', 'above']) {
    if (RANK[previous] >= RANK[s] && RANK[status] < RANK[s] && holds[s]) status = s;
  }
  return { status, p, ratio };
}

export const rank = (status) => RANK[status] ?? 0;

/** "+350%" style change, or null when the expected count is too small for a percentage. */
export function changeRatio(count, expected) {
  if (expected < MIN_EXPECTED_FOR_PERCENT) return null;
  return Math.round((count / expected - 1) * 100);
}

/**
 * Every place's window, baseline and status for each series, at the counts' last day.
 * @param data      lib/counts.mjs data
 * @param config    { windowDays, baselineDays, above, far, stay }
 * @param previous  { placeId: { series: status } } of the last assessment
 * @returns { through, learning, places: { placeId: { series: { status, count, expected } } } }
 *   learning: not enough history yet (at least 3/4 of the baseline); every status is normal
 */
export function assessAll(data, config, previous = {}) {
  const through = data.last;
  if (!through) return { through: null, learning: true, places: {} };
  const baselineEnd = addDays(through, -config.windowDays);
  const places = {};
  let learning = false;
  for (const [place, series] of Object.entries(data.series)) {
    for (const name of Object.keys(series)) {
      const w = windowSum(data, place, name, through, config.windowDays);
      const b = windowSum(data, place, name, baselineEnd, config.baselineDays);
      if (b.days < config.baselineDays * 0.75 || w.days < config.windowDays - 1) { learning = true; continue; }
      const expected = b.sum * (w.days / b.days);
      const { status } = assess({ count: w.sum, expected }, config, previous[place]?.[name]);
      (places[place] ??= {})[name] = { status, count: w.sum, expected: Math.round(expected * 10) / 10 };
    }
  }
  return { through, learning, places: learning ? {} : places };
}
