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
//
// The backend asks every 5 minutes instead of every 30, with `precise`:
//   - a daily-slot source is due from a pseudo-random minute of the day (slotMinute), so
//     nothing has to sleep before it to spread the calls;
//   - an interval source is due 2 minutes early at most, so an hourly source runs hourly;
//   - a source whose last attempt failed isn't tried again for 30 minutes (the rate-limited
//     U.S. API would otherwise be called every 5).
// The old rules stay for the update workflow until it is removed.

import { createHash } from 'node:crypto';

// Scheduled runs start a few minutes late, so an hourly source is due a little early.
const TOLERANCE_MINUTES = 10;
const PRECISE_TOLERANCE_MINUTES = 2;
const RETRY_MINUTES = 30;
const SLOT_HOURS = 22;

/** Today's daily-slot hour (0–21 UTC), the same for every source on a given day. */
export function slotHour(day, seed) {
  return parseInt(createHash('sha256').update(`${day}-${seed}`).digest('hex').slice(0, 8), 16) % SLOT_HOURS;
}

/** Today's daily-slot minute of the day (0–1319: never in hours 22–23), the same for every source on a given day. */
export function slotMinute(day, seed) {
  return parseInt(createHash('sha256').update(`${day}-${seed}-minute`).digest('hex').slice(0, 8), 16) % (SLOT_HOURS * 60);
}

const hhmm = (minute) => `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;

/**
 * @param schedule   config/schedule.json
 * @param state      data/sources-state.json ({ id: { lastSuccess } })
 * @param now        Date
 * @param seed       the repository name (makes the slot hour differ from other forks)
 * @param manual     true for a manual run
 * @param only       for a manual run, the ids to fetch ('all' or empty means every one)
 * @param precise    the backend's rules (see the top of this file); `state` then also needs lastAttempt
 * @returns { due: [ids], jitter, reasons: { id: text } }
 *   jitter: a daily-slot source runs at its on-time hour, so the workflow may wait a random
 *   few minutes first (catch-up runs go straight away)
 */
export function dueSources({ schedule, state, now, seed, manual = false, only = '', precise = false }) {
  const today = now.toISOString().slice(0, 10);
  const hour = now.getUTCHours();
  const target = slotHour(today, seed);
  const minute = hour * 60 + now.getUTCMinutes();
  const targetMinute = slotMinute(today, seed);
  const tolerance = precise ? PRECISE_TOLERANCE_MINUTES : TOLERANCE_MINUTES;
  const wanted = String(only).split(/[\s,]+/).filter(x => x && x !== 'all');
  const due = [];
  const reasons = {};
  let jitter = false;

  for (const [id, rule] of Object.entries(schedule)) {
    const last = state[id]?.lastSuccess;
    let why = null;
    const attempt = state[id]?.lastAttempt;
    const sinceFailure = precise && attempt && attempt !== last ? (now - Date.parse(attempt)) / 60000 : Infinity;
    if (manual) {
      why = !wanted.length || wanted.includes(id) ? 'manual run' : null;
      if (!why) reasons[id] = 'not requested';
    } else if (!rule.everyMinutes && rule.every !== 'daily-slot') {
      throw new Error(`config/schedule.json: "${id}" needs "every": "daily-slot" or "everyMinutes"`);
    } else if (sinceFailure < RETRY_MINUTES) {
      reasons[id] = `failed ${Math.round(sinceFailure)} min ago, retried after ${RETRY_MINUTES}`;
    } else if (rule.every === 'daily-slot' && precise) {
      if (last?.slice(0, 10) === today) reasons[id] = 'already updated today';
      else if (minute < targetMinute) reasons[id] = `today's slot is ${hhmm(targetMinute)} UTC`;
      else why = minute - targetMinute < 60 ? "today's slot" : 'catching up';
    } else if (rule.every === 'daily-slot') {
      if (last?.slice(0, 10) === today) reasons[id] = 'already updated today';
      else if (hour < target) reasons[id] = `today's slot is ${target}:xx UTC`;
      else {
        why = hour === target ? "today's slot" : 'catching up';
        if (hour === target) jitter = true;
      }
    } else if (rule.everyMinutes) {
      const age = last ? (now - Date.parse(last)) / 60000 : Infinity;
      if (age >= rule.everyMinutes - tolerance) why = last ? `last success ${Math.round(age)} min ago` : 'never fetched';
      else reasons[id] = `fetched ${Math.round(age)} min ago`;
    }
    if (why) { due.push(id); reasons[id] = why; }
  }
  return { due, jitter: jitter && !manual, reasons };
}
