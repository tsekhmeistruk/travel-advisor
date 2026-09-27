import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dueSources, slotHour } from '../../../scripts/lib/schedule.mjs';

const SEED = 'tsekhmeistruk/travel-advisor';
const SCHEDULE = { us: { every: 'daily-slot' }, ca: { every: 'daily-slot' }, gdacs: { everyMinutes: 60 } };
const at = (hhmm, day = '2026-09-27') => new Date(`${day}T${hhmm}:00Z`);

describe('slotHour', () => {
  test('matches the hour the old workflow computed with sha256sum, and is never 22 or 23', () => {
    // printf '%s' "2026-09-27-tsekhmeistruk/travel-advisor" | sha256sum | cut -c1-8  ->  f29e7186
    assert.equal(slotHour('2026-09-27', SEED), 0xf29e7186 % 22);
    for (let d = 1; d <= 28; d++) {
      const h = slotHour(`2026-10-${String(d).padStart(2, '0')}`, SEED);
      assert.ok(h >= 0 && h < 22, `hour ${h}`);
    }
  });
});

describe('dueSources', () => {
  const target = slotHour('2026-09-27', SEED);   // 14
  const hh = (h) => `${String(h).padStart(2, '0')}:17`;

  test('daily-slot sources wait for today\'s slot, run at it with jitter, and catch up later without', () => {
    const before = dueSources({ schedule: SCHEDULE, state: {}, now: at(hh(target - 1)), seed: SEED });
    assert.deepEqual(before.due, ['gdacs']);
    assert.equal(before.reasons.us, `today's slot is ${target}:xx UTC`);

    const onTime = dueSources({ schedule: SCHEDULE, state: {}, now: at(hh(target)), seed: SEED });
    assert.deepEqual(onTime.due, ['us', 'ca', 'gdacs']);
    assert.equal(onTime.jitter, true);

    const late = dueSources({ schedule: SCHEDULE, state: {}, now: at(hh(target + 2)), seed: SEED });
    assert.deepEqual(late.due, ['us', 'ca', 'gdacs']);
    assert.equal(late.jitter, false);
    assert.equal(late.reasons.us, 'catching up');
  });

  test('a daily-slot source that succeeded today is done; one that failed retries next hour', () => {
    const state = { us: { lastSuccess: '2026-09-27T14:20:00Z' }, ca: { lastSuccess: '2026-09-26T14:20:00Z' } };
    const r = dueSources({ schedule: SCHEDULE, state, now: at(hh(target + 1)), seed: SEED });
    assert.ok(!r.due.includes('us'));
    assert.equal(r.reasons.us, 'already updated today');
    assert.ok(r.due.includes('ca'));
  });

  test('interval sources run when the last success is old enough, a little early for a late cron', () => {
    const state = (min) => ({ gdacs: { lastSuccess: new Date(Date.parse('2026-09-27T09:17:00Z') - min * 60000).toISOString() } });
    const now = at('09:17');
    assert.ok(dueSources({ schedule: SCHEDULE, state: state(60), now, seed: SEED }).due.includes('gdacs'));
    assert.ok(dueSources({ schedule: SCHEDULE, state: state(52), now, seed: SEED }).due.includes('gdacs'), 'within the 10-minute tolerance');
    const recent = dueSources({ schedule: SCHEDULE, state: state(20), now, seed: SEED });
    assert.ok(!recent.due.includes('gdacs'));
    assert.equal(recent.reasons.gdacs, 'fetched 20 min ago');
    assert.equal(dueSources({ schedule: SCHEDULE, state: {}, now, seed: SEED }).reasons.gdacs, 'never fetched');
  });

  test('a manual run fetches everything, or only the ids it names, and never waits', () => {
    const state = { us: { lastSuccess: '2026-09-27T05:00:00Z' }, gdacs: { lastSuccess: '2026-09-27T09:10:00Z' } };
    assert.deepEqual(dueSources({ schedule: SCHEDULE, state, now: at(hh(target)), seed: SEED, manual: true }).due, ['us', 'ca', 'gdacs']);
    const some = dueSources({ schedule: SCHEDULE, state, now: at(hh(target)), seed: SEED, manual: true, only: 'gdacs, ca' });
    assert.deepEqual(some.due, ['ca', 'gdacs']);
    assert.equal(some.reasons.us, 'not requested');
    assert.equal(some.jitter, false);
    assert.deepEqual(dueSources({ schedule: SCHEDULE, state, now: at('01:00'), seed: SEED, manual: true, only: 'all' }).due, ['us', 'ca', 'gdacs']);
  });

  test('rejects a schedule entry without a rule', () => {
    assert.throws(() => dueSources({ schedule: { xx: {} }, state: {}, now: at('01:00'), seed: SEED }), /"xx" needs/);
  });
});
