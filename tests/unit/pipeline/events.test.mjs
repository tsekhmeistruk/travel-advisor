import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEvents } from '../../../scripts/lib/events.mjs';

const T0 = '2026-09-27T10:00:00.000Z';
const T1 = '2026-09-27T11:00:00.000Z';
const T2 = '2026-09-27T12:00:00.000Z';
const T3 = '2026-09-27T13:00:00.000Z';
const OPTS = { lookbackDays: 30, retainEndedDays: 90 };
const ev = (id, value = 'Orange', extra = {}) => ({
  id, code: 'TC', native: { scheme: 'gdacs-alert', value }, startedAt: '2026-09-20T00:00:00.000Z', toDate: '2026-09-27T09:00:00.000Z', current: true, ...extra,
});

describe('mergeEvents', () => {
  test('adds new events with their first sighting as the first revision, sorted by id', () => {
    const { events, stats } = mergeEvents([], [ev('b'), ev('a', 'Red')], { at: T0, ...OPTS });
    assert.deepEqual(events.map(e => e.id), ['a', 'b']);
    assert.deepEqual(events[0].revisions, [{ at: T0, value: 'Red' }]);
    assert.equal(events[0].firstSeen, T0);
    assert.equal(events[0].updatedSeen, T0);
    assert.deepEqual(stats.added, ['b', 'a']);
  });

  test('is idempotent: the same response twice changes nothing but the copy', () => {
    const once = mergeEvents([], [ev('a')], { at: T0, ...OPTS }).events;
    const twice = mergeEvents(once, [ev('a')], { at: T1, ...OPTS });
    assert.deepEqual(twice.events, once);
    assert.deepEqual(twice.stats.added, []);
    assert.deepEqual(twice.stats.levelChanged, []);
  });

  test('a new alert level becomes a revision; other edits replace the copy silently', () => {
    const once = mergeEvents([], [ev('a')], { at: T0, ...OPTS }).events;
    const next = mergeEvents(once, [ev('a', 'Red', { name: 'renamed', episode: 29 })], { at: T1, ...OPTS });
    const a = next.events[0];
    assert.deepEqual(a.revisions, [{ at: T0, value: 'Orange' }, { at: T1, value: 'Red' }]);
    assert.equal(a.firstSeen, T0);
    assert.equal(a.name, 'renamed');
    assert.deepEqual(next.stats.levelChanged, ['a Orange → Red']);
    const edited = mergeEvents(next.events, [ev('a', 'Red', { name: 'again' })], { at: '2026-09-27T12:00:00.000Z', ...OPTS });
    assert.equal(edited.events[0].revisions.length, 2, 'a text edit adds no revision');
  });

  test('counts an event listed twice (across pages) once', () => {
    const { events, stats } = mergeEvents([], [ev('a'), ev('a', 'Red')], { at: T0, ...OPTS });
    assert.equal(events.length, 1);
    assert.equal(events[0].native.value, 'Orange', 'the first copy (newest first) wins');
    assert.equal(stats.received, 2);
  });

  test('missing is not ended: a current event absent from the response is kept, with the first fetch that missed it', () => {
    const once = mergeEvents([], [ev('a')], { at: T0, ...OPTS }).events;
    const next = mergeEvents(once, [], { at: T1, ...OPTS });
    assert.deepEqual(next.events, [{ ...once[0], missingSince: T1 }]);
    assert.deepEqual(next.stats.closed, []);
    const still = mergeEvents(next.events, [], { at: T2, ...OPTS });
    assert.equal(still.events[0].missingSince, T1, 'the first miss stays');
    const back = mergeEvents(still.events, [ev('a')], { at: T3, ...OPTS });
    assert.deepEqual(back.events, once, 'back in the response: as if it never left');
  });

  test('updatedSeen: the fetch that first had the event, or last had it with another end date or alert level', () => {
    const once = mergeEvents([], [ev('a')], { at: T0, ...OPTS }).events;
    assert.equal(once[0].updatedSeen, T0, 'the first sighting counts');
    const flag = mergeEvents(once, [ev('a', 'Orange', { current: false, episode: 30, name: 'renamed' })], { at: T1, ...OPTS }).events;
    assert.equal(flag[0].updatedSeen, T0, 'another flag, episode or name is not an extension');
    const longer = mergeEvents(flag, [ev('a', 'Orange', { toDate: '2026-09-28T09:00:00.000Z' })], { at: T2, ...OPTS }).events;
    assert.equal(longer[0].updatedSeen, T2, 'the end date moved');
    const red = mergeEvents(longer, [ev('a', 'Red', { toDate: '2026-09-28T09:00:00.000Z' })], { at: T3, ...OPTS }).events;
    assert.equal(red[0].updatedSeen, T3, 'the alert level moved');
    assert.deepEqual(Object.keys(red[0]).slice(-3), ['firstSeen', 'updatedSeen', 'revisions'], 'stored after the source\'s own fields');
  });

  test('an event stored before updatedSeen existed gets none until the source moves it', () => {
    const old = { ...ev('a'), firstSeen: T0, revisions: [{ at: T0, value: 'Orange' }] };
    const same = mergeEvents([old], [ev('a')], { at: T1, ...OPTS }).events;
    assert.equal('updatedSeen' in same[0], false);
    const moved = mergeEvents(same, [ev('a', 'Orange', { toDate: '2026-09-28T09:00:00.000Z' })], { at: T2, ...OPTS }).events;
    assert.equal(moved[0].updatedSeen, T2);
  });

  test('closes a "current" event that is older than the lookback window, so it can no longer be listed', () => {
    const old = { ...ev('a', 'Orange', { toDate: '2026-08-01T00:00:00.000Z' }), firstSeen: T0, revisions: [] };
    const { events, stats } = mergeEvents([old], [], { at: T1, ...OPTS });
    assert.equal(events[0].current, false);
    assert.equal(events[0].missingSince, T1);
    assert.deepEqual(stats.closed, ['a']);
  });

  test('drops ended events retainEndedDays after their end, returning them for the archive', () => {
    const ended = { ...ev('old', 'Orange', { current: false, toDate: '2026-06-01T00:00:00.000Z' }), firstSeen: T0, revisions: [] };
    const recent = { ...ev('recent', 'Orange', { current: false, toDate: '2026-09-01T00:00:00.000Z' }), firstSeen: T0, revisions: [] };
    const { events, expired, stats } = mergeEvents([ended, recent], [], { at: T1, ...OPTS });
    assert.deepEqual(events.map(e => e.id), ['recent']);
    assert.deepEqual(expired.map(e => e.id), ['old']);
    assert.equal(stats.expired, 1);
  });
});
