import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseApiItems, mergeWithPrevious } from '../../../scripts/providers/us/parse.mjs';

const fixture = (f) => readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8');
const apiItems = JSON.parse(fixture('us-api.json'));
const TODAY = '2026-09-27';

describe('parseApiItems', () => {
  const { byName, duplicates } = parseApiItems(apiItems, [], TODAY);

  test('reads name, level, UTC date and link from real API items', () => {
    assert.deepEqual(byName.get('Saudi Arabia'), {
      name: 'Saudi Arabia', lastSeen: TODAY, level: 3, updated: '2026-09-15',
      url: 'https://travel.state.gov/content/tsg_aem/us/en/home/international-travel/travel-advisories/destination.sau.html',
    });
    assert.equal(duplicates, 0);
  });

  test('strips the "Travel Advisory" suffix (Mexico)', () => {
    assert.ok(byName.has('Mexico'));
    assert.ok(![...byName.keys()].some(n => /Travel Advisory/.test(n)));
  });

  test('names combined "See Summaries" entries by country code', () => {
    assert.equal(byName.get('Macau')?.level, 3);
    assert.ok(![...byName.keys()].some(n => /See Summaries/.test(n)));
  });

  test('converts 20:00 U.S. Eastern times to the next UTC date', () => {
    const [item] = parseApiItems([{ Title: 'Chad - Level 4: Do Not Travel', Updated: '2026-04-27T20:00:00-04:00', Link: 'x' }], [], TODAY).byName.values();
    assert.equal(item.updated, '2026-04-28');
  });

  test('matches spelling variants to the name already on file', () => {
    const previous = [{ name: 'Côte d’Ivoire' }];
    const { byName: m } = parseApiItems([{ Title: 'Cote d Ivoire - Level 2: Exercise Increased Caution', Updated: '2026-02-17T19:00:00-05:00', Link: 'x' }], previous, TODAY);
    assert.deepEqual([...m.keys()], ['Côte d’Ivoire']);
  });

  test('keeps the newer copy of a duplicated advisory and warns on differing levels', () => {
    const items = [
      { Title: 'Bangladesh - Level 3: Reconsider Travel', Updated: '2026-01-19T19:00:00-05:00', Link: 'old' },
      { Title: 'Bangladesh - Level 2: Exercise Increased Caution', Updated: '2026-07-29T20:00:00-04:00', Link: 'new' },
    ];
    const r = parseApiItems(items, [], TODAY);
    assert.equal(r.duplicates, 1);
    assert.equal(r.byName.get('Bangladesh').level, 2);
    assert.match(r.warnings[0], /different levels/);
  });

  test('rejects an unrecognised title rather than guessing', () => {
    assert.throws(() => parseApiItems([{ Title: 'Something else entirely', Updated: '2026-01-01' }], [], TODAY), /Unrecognised advisory title/);
  });
});

describe('mergeWithPrevious', () => {
  const prevEntry = (name, updated, level, extra = {}) => ({ name, updated, level, lastSeen: '2026-09-26', url: 'u', ...extra });

  test('ignores an outdated API copy and keeps the saved entry (Bangladesh case)', () => {
    const byName = new Map([['Bangladesh', { name: 'Bangladesh', level: 3, updated: '2026-01-20', lastSeen: TODAY, url: 'stale' }]]);
    const { entries, stale } = mergeWithPrevious(byName, [prevEntry('Bangladesh', '2026-07-30', 2)], TODAY, 7);
    assert.equal(entries[0].level, 2);
    assert.equal(entries[0].updated, '2026-07-30');
    assert.equal(entries[0].lastSeen, TODAY);
    assert.equal(stale.length, 1);
  });

  test('accepts a newer date at the same level immediately', () => {
    const byName = new Map([['Chad', { name: 'Chad', level: 3, updated: '2026-09-20', lastSeen: TODAY }]]);
    const { entries, stale, unconfirmed } = mergeWithPrevious(byName, [prevEntry('Chad', '2026-04-28', 3)], TODAY, 7);
    assert.equal(entries[0].updated, '2026-09-20');
    assert.deepEqual([stale.length, unconfirmed.length], [0, 0]);
  });

  describe('level changes need confirmation on a later day', () => {
    const DAY2 = '2026-09-28';
    const apiSays = (level, updated) => new Map([['Chad', { name: 'Chad', level, updated, lastSeen: TODAY, url: 'u' }]]);

    test('a new level is held: the saved entry stays and the candidate is pending', () => {
      const { entries, unconfirmed } = mergeWithPrevious(apiSays(4, '2026-09-20'), [prevEntry('Chad', '2026-04-28', 3)], TODAY, 7);
      assert.equal(entries[0].level, 3);
      assert.equal(entries[0].updated, '2026-04-28');
      assert.deepEqual(entries[0].pending, { level: 4, updated: '2026-09-20', url: 'u', firstSeen: TODAY });
      assert.match(unconfirmed[0], /Chad L3 → L4/);
    });

    test('seeing it again the same day does not confirm it', () => {
      const first = mergeWithPrevious(apiSays(4, '2026-09-20'), [prevEntry('Chad', '2026-04-28', 3)], TODAY, 7).entries;
      const { entries } = mergeWithPrevious(apiSays(4, '2026-09-20'), first, TODAY, 7);
      assert.equal(entries[0].level, 3);
      assert.equal(entries[0].pending.firstSeen, TODAY);
    });

    test('seeing it again on a later day confirms and applies it', () => {
      const first = mergeWithPrevious(apiSays(4, '2026-09-20'), [prevEntry('Chad', '2026-04-28', 3)], TODAY, 7).entries;
      const { entries, confirmed } = mergeWithPrevious(apiSays(4, '2026-09-20'), first, DAY2, 7);
      assert.equal(entries[0].level, 4);
      assert.equal(entries[0].pending, undefined);
      assert.match(confirmed[0], /Chad L3 → L4 \(first seen 2026-09-27\)/);
    });

    test('regression: a one-off bogus "updated today" level is never applied (Ethiopia)', () => {
      // Saved: Level 3 from Aug 27. One response says Level 1, dated the fetch day.
      const saved = [{ name: 'Ethiopia', level: 3, updated: '2026-08-27', lastSeen: '2026-09-26', url: 'u' }];
      const bogus = new Map([['Ethiopia', { name: 'Ethiopia', level: 1, updated: TODAY, lastSeen: TODAY, url: 'u' }]]);
      const day1 = mergeWithPrevious(bogus, saved, TODAY, 7).entries;
      assert.equal(day1[0].level, 3);
      // Next day the API is correct again (Level 3, Aug 27): accepted, and the candidate is gone.
      const correct = new Map([['Ethiopia', { name: 'Ethiopia', level: 3, updated: '2026-08-27', lastSeen: DAY2, url: 'u' }]]);
      const day2 = mergeWithPrevious(correct, day1, DAY2, 7);
      assert.equal(day2.entries[0].level, 3);
      assert.equal(day2.entries[0].pending, undefined);
      assert.deepEqual(day2.stale, [], 'the correct data must not be rejected as stale');
    });

    test('a different candidate restarts the wait', () => {
      const first = mergeWithPrevious(apiSays(4, '2026-09-20'), [prevEntry('Chad', '2026-04-28', 3)], TODAY, 7).entries;
      const { entries } = mergeWithPrevious(apiSays(2, '2026-09-21'), first, DAY2, 7);
      assert.equal(entries[0].level, 3);
      assert.deepEqual([entries[0].pending.level, entries[0].pending.firstSeen], [2, DAY2]);
    });

    test('a pending candidate survives stale copies and missing responses, then expires', () => {
      const first = mergeWithPrevious(apiSays(4, '2026-09-20'), [prevEntry('Chad', '2026-04-28', 3)], TODAY, 7).entries;
      assert.ok(mergeWithPrevious(apiSays(3, '2026-01-01'), first, DAY2, 7).entries[0].pending, 'kept through a stale copy');
      assert.ok(mergeWithPrevious(new Map(), first, DAY2, 7).entries[0].pending, 'kept while missing');
      assert.equal(mergeWithPrevious(apiSays(3, '2026-01-01'), first, '2026-10-10', 7).entries[0].pending, undefined, 'expired');
    });
  });

  test('keeps an advisory missing from the response within the grace period', () => {
    const { entries, carried } = mergeWithPrevious(new Map(), [prevEntry('Brazil', '2026-08-31', 2, { lastSeen: '2026-09-22' })], TODAY, 7);
    assert.deepEqual(carried, ['Brazil']);
    assert.equal(entries[0].lastSeen, '2026-09-22', 'lastSeen must not be refreshed for a carried entry');
  });

  test('drops an advisory unseen for longer than the grace period', () => {
    const { entries, dropped } = mergeWithPrevious(new Map(), [prevEntry('Gone', '2025-01-01', 1, { lastSeen: '2026-09-10' })], TODAY, 7);
    assert.deepEqual(dropped, ['Gone']);
    assert.equal(entries.length, 0);
  });

  test('returns entries sorted by name', () => {
    const byName = new Map([['Zambia', { name: 'Zambia', updated: '2026-01-01' }], ['Albania', { name: 'Albania', updated: '2026-01-01' }]]);
    assert.deepEqual(mergeWithPrevious(byName, [], TODAY, 7).entries.map(e => e.name), ['Albania', 'Zambia']);
  });
});
