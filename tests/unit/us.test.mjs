import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseApiItems, mergeWithPrevious, parseRssNotes, attachNotes } from '../../scripts/lib/us.mjs';

const fixture = (f) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8');
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

  test('accepts a newer entry over the saved one', () => {
    const byName = new Map([['Chad', { name: 'Chad', level: 4, updated: '2026-09-20', lastSeen: TODAY }]]);
    const { entries, stale } = mergeWithPrevious(byName, [prevEntry('Chad', '2026-04-28', 3)], TODAY, 7);
    assert.equal(entries[0].level, 4);
    assert.equal(stale.length, 0);
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

describe('parseRssNotes and attachNotes', () => {
  const notes = parseRssNotes(fixture('us-rss.xml'));

  test('extracts change notes from real RSS items', () => {
    assert.match(notes.get('chad').note, /^The advisory level was increased to 4\./);
    assert.equal(notes.get('georgia').note, 'Reissued after periodic review with minor edits.');
    assert.equal(notes.get('tonga').date, '2024-12-02');
  });

  test('skips items whose first paragraph is advisory text, not a change note (Mexico)', () => {
    assert.equal(notes.has('mexico'), false);
  });

  test('attaches a note only when its date matches the entry within a day', () => {
    const entries = [
      { name: 'Suriname', updated: '2026-09-08' },   // same date
      { name: 'Chad', updated: '2026-04-29' },       // one day off: allowed
      { name: 'Bangladesh', updated: '2026-07-30' }, // RSS copy is from January: stale, not attached
    ];
    assert.equal(attachNotes(entries, notes), 2);
    assert.match(entries[0].change, /no changes to the advisory level/);
    assert.ok(entries[1].change);
    assert.equal(entries[2].change, undefined);
  });
});
