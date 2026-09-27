// Which providers and sources are due for a fetch (pure). The update workflow runs hourly and
// asks scripts/due.mjs; each entry in config/schedule.json says how often it runs:
//
//   { "every": "daily-slot" }   once per UTC day, at a pseudo-random hour picked from the date,
//                               so the rate-limited U.S. API isn't called at the same time
//                               every day. Later hours catch up if a run failed or was
//                               skipped; hours 22–23 are never picked, so they're spare.
//   { "everyMinutes": 60 }      when the last success is at least that old
//
// A manual run ("Run workflow") fetches everything, or the sources it names.

import { createHash } from 'node:crypto';

// Scheduled runs start a few minutes late, so an hourly source is due a little early.
const TOLERANCE_MINUTES = 10;
const SLOT_HOURS = 22;

/** Today's daily-slot hour (0–21 UTC), the same for every source on a given day. */
export function slotHour(day, seed) {
  return parseInt(createHash('sha256').update(`${day}-${seed}`).digest('hex').slice(0, 8), 16) % SLOT_HOURS;
}

/**
 * @param schedule   config/schedule.json
 * @param state      data/sources-state.json ({ id: { lastSuccess } })
 * @param now        Date
 * @param seed       the repository name (makes the slot hour differ from other forks)
 * @param manual     true for a manual run
 * @param only       for a manual run, the ids to fetch ('all' or empty means every one)
 * @returns { due: [ids], jitter, reasons: { id: text } }
 *   jitter: a daily-slot source runs at its on-time hour, so the workflow may wait a random
 *   few minutes first (catch-up runs go straight away)
 */
export function dueSources({ schedule, state, now, seed, manual = false, only = '' }) {
  const today = now.toISOString().slice(0, 10);
  const hour = now.getUTCHours();
  const target = slotHour(today, seed);
  const wanted = String(only).split(/[\s,]+/).filter(x => x && x !== 'all');
  const due = [];
  const reasons = {};
  let jitter = false;

  for (const [id, rule] of Object.entries(schedule)) {
    const last = state[id]?.lastSuccess;
    let why = null;
    if (manual) {
      why = !wanted.length || wanted.includes(id) ? 'manual run' : null;
      if (!why) reasons[id] = 'not requested';
    } else if (rule.every === 'daily-slot') {
      if (last?.slice(0, 10) === today) reasons[id] = 'already updated today';
      else if (hour < target) reasons[id] = `today's slot is ${target}:xx UTC`;
      else {
        why = hour === target ? "today's slot" : 'catching up';
        if (hour === target) jitter = true;
      }
    } else if (rule.everyMinutes) {
      const age = last ? (now - Date.parse(last)) / 60000 : Infinity;
      if (age >= rule.everyMinutes - TOLERANCE_MINUTES) why = last ? `last success ${Math.round(age)} min ago` : 'never fetched';
      else reasons[id] = `fetched ${Math.round(age)} min ago`;
    } else {
      throw new Error(`config/schedule.json: "${id}" needs "every": "daily-slot" or "everyMinutes"`);
    }
    if (why) { due.push(id); reasons[id] = why; }
  }
  return { due, jitter: jitter && !manual, reasons };
}
