import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { place, isMinorChange, classifyUpdates, trackHistory, buildSources, SOURCES } from '../../scripts/lib/build.mjs';

describe('place', () => {
  test('maps an advisory name to its map shape', () => {
    assert.deepEqual(place({ name: 'Burma', level: 4 }).shapes, ['Myanmar']);
  });
  test('keeps names that already match the map', () => {
    assert.deepEqual(place({ name: 'France', level: 2 }).shapes, ['France']);
  });
  test('supports one advisory covering several shapes', () => {
    assert.deepEqual(place({ name: 'Israel and Palestine', level: 3 }).shapes, ['Israel', 'Gaza', 'West Bank']);
  });
  test('uses a point for places too small for the map', () => {
    const p = place({ name: 'Tuvalu', level: 1 });
    assert.deepEqual(p.point, [179.2, -8.5]);
    assert.equal(p.shapes, undefined);
  });
  test('uses a note for umbrella advisories without a shape', () => {
    assert.match(place({ name: 'French West Indies', level: 1 }).note, /Guadeloupe/);
  });
  test('drops fetch-only bookkeeping fields', () => {
    const p = place({ name: 'Chad', level: 4, stamp: 's', lastSeen: 'd' });
    assert.equal('stamp' in p, false);
    assert.equal('lastSeen' in p, false);
  });
});

describe('isMinorChange', () => {
  const minor = [
    'Health – editorial change',
    'Editorial change',
    'The Health section was updated - travel health information (Public Health Agency of Canada)',
    'Reissued after periodic review without changes.',
    'Reissued after periodic review with minor edits.',
    'Reissued with obsolete COVID-19 page links removed.',
    'Health – editorial change; Editorial change',
  ];
  const real = [
    'Risk levels section – avoid all travel to Afar; safety and security section – added information on the security situation in northern Ethiopia',
    'Health – editorial change; Risk levels section – avoid non-essential travel to Baja California Sur',
    'There were no changes to the advisory level or risk indicators. Advisory summary was updated.',
    'The advisory level was increased to 4. The “health” indicator was added.',
    'Natural disasters and climate section – updated information on Hurricane Polo',
  ];
  for (const t of minor) test(`minor: ${t.slice(0, 60)}`, () => assert.equal(isMinorChange(t), true));
  for (const t of real) test(`real: ${t.slice(0, 60)}`, () => assert.equal(isMinorChange(t), false));
});

describe('classifyUpdates', () => {
  test('uses the change note when there is one', () => {
    const list = [
      { name: 'A', updated: '2026-09-24', change: 'Health – editorial change' },
      { name: 'B', updated: '2026-09-24', change: 'Risk levels section – avoid all travel to Afar' },
    ];
    classifyUpdates(list);
    assert.equal(list[0].minorUpdate, true);
    assert.equal(list[1].minorUpdate, undefined);
  });

  test('without notes, treats a date shared by over 40% of entries as a bulk republish', () => {
    const list = [
      ...Array.from({ length: 5 }, (_, i) => ({ name: `bulk${i}`, updated: '2026-09-24' })),
      { name: 'x', updated: '2026-09-20' }, { name: 'y', updated: '2026-09-21' },
    ];
    classifyUpdates(list);
    assert.equal(list.filter(a => a.minorUpdate).length, 5);
    assert.equal(list.at(-1).minorUpdate, undefined);
  });
});

describe('trackHistory', () => {
  test('records the first snapshot without reporting a change', () => {
    const history = {};
    const list = [{ name: 'Chad', level: 3 }];
    trackHistory(history, 'us', '2026-09-26', list);
    assert.deepEqual(history.us.Chad, [{ date: '2026-09-26', level: 3 }]);
    assert.equal(list[0].levelChange, undefined);
  });

  test('records a level change on a later date and reports it', () => {
    const history = { us: { Chad: [{ date: '2026-09-26', level: 3 }] } };
    const list = [{ name: 'Chad', level: 4 }];
    trackHistory(history, 'us', '2026-09-27', list);
    assert.deepEqual(list[0].levelChange, { date: '2026-09-27', from: 3, to: 4 });
    assert.equal(history.us.Chad.length, 2);
  });

  test('keeps reporting the latest change on later unchanged snapshots', () => {
    const history = { us: { Chad: [{ date: '2026-09-26', level: 3 }, { date: '2026-09-27', level: 4 }] } };
    const list = [{ name: 'Chad', level: 4 }];
    trackHistory(history, 'us', '2026-09-30', list);
    assert.equal(history.us.Chad.length, 2);
    assert.deepEqual(list[0].levelChange, { date: '2026-09-27', from: 3, to: 4 });
  });

  test('ignores a different level within the same day (no flapping from one bad response)', () => {
    const history = { us: { Chad: [{ date: '2026-09-26', level: 3 }] } };
    trackHistory(history, 'us', '2026-09-26', [{ name: 'Chad', level: 4 }]);
    assert.equal(history.us.Chad.length, 1);
  });
});

describe('buildSources', () => {
  const mapNames = new Set(['France', 'Myanmar', 'Somalia', 'Somaliland', 'Cyprus', 'N. Cyprus', 'Denmark', 'Faeroe Is.', 'Finland', 'Åland',
    'Portugal', 'Azores', 'Spain', 'Canary Islands', 'Réunion', 'Mayotte']);
  const usAdvisories = ['France', 'Burma', 'Somalia', 'Cyprus', 'Kingdom of Denmark', 'Finland', 'Portugal', 'Spain']
    .map(name => ({ name, level: 2, updated: '2026-09-01' }));

  test('builds a source with its metadata and placed advisories', () => {
    const { sources, problems } = buildSources({ us: { asOf: '2026-09-26', advisories: usAdvisories } }, {}, mapNames);
    assert.deepEqual(problems, []);
    assert.equal(sources.us.agency, SOURCES.us.agency);
    assert.equal(sources.us.asOf, '2026-09-26');
    assert.deepEqual(sources.us.advisories.find(a => a.name === 'Burma').shapes, ['Myanmar']);
  });

  test('reports an advisory that cannot be placed on the map', () => {
    const { problems } = buildSources({ us: { asOf: '2026-09-26', advisories: [...usAdvisories, { name: 'Atlantis', level: 1, updated: '2026-09-01' }] } }, {}, mapNames);
    assert.ok(problems.some(p => /No map shape "Atlantis"/.test(p)));
  });

  test('reports a covered-by rule whose advisory is missing', () => {
    const { problems } = buildSources({ us: { asOf: '2026-09-26', advisories: usAdvisories.filter(a => a.name !== 'Somalia') } }, {}, mapNames);
    assert.ok(problems.some(p => /coveredBy advisory "Somalia" not in data/.test(p)));
  });

  test('reports an unknown source key', () => {
    assert.ok(buildSources({ xx: { asOf: '2026-09-26', advisories: [] } }, {}, mapNames).problems.some(p => /Unknown source/.test(p)));
  });
});
