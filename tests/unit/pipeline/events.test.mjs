import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEvents } from '../../../scripts/lib/events.mjs';

const T0 = '2026-09-27T10:00:00.000Z';
const T1 = '2026-09-27T11:00:00.000Z';
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

  test('missing is not ended: a current event absent from the response is kept as it was', () => {
    const once = mergeEvents([], [ev('a')], { at: T0, ...OPTS }).events;
    const next = mergeEvents(once, [], { at: T1, ...OPTS });
    assert.deepEqual(next.events, once);
    assert.deepEqual(next.stats.closed, []);
  });

  test('closes a "current" event that is older than the lookback window, so it can no longer be listed', () => {
    const old = { ...ev('a', 'Orange', { toDate: '2026-08-01T00:00:00.000Z' }), firstSeen: T0, revisions: [] };
    const { events, stats } = mergeEvents([old], [], { at: T1, ...OPTS });
    assert.equal(events[0].current, false);
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
