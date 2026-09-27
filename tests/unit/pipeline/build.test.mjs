import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  placeIndex, resolvePlaces, checkPlaces, isMinorChange, classifyUpdates, trackHistory, buildProvider, buildSite,
} from '../../../scripts/lib/build.mjs';
import us from '../../../scripts/providers/us/index.mjs';
import ca from '../../../scripts/providers/ca/index.mjs';

const PLACES = [
  { id: 'fr', name: 'France', iso2: 'FR', shape: 'France' },
  { id: 'mm', name: 'Myanmar', iso2: 'MM', shape: 'Myanmar' },
  { id: 'so', name: 'Somalia', iso2: 'SO', shape: 'Somalia' },
  { id: 'somaliland', name: 'Somaliland', shape: 'Somaliland' },
  { id: 'cd', name: 'Democratic Republic of the Congo', iso2: 'CD', shape: 'Dem. Rep. Congo' },
  { id: 'il', name: 'Israel', iso2: 'IL', shape: 'Israel' },
  { id: 'gaza', name: 'Gaza', shape: 'Gaza' },
  { id: 'us', name: 'United States', iso2: 'US', shape: 'United States of America' },
  { id: 'tv', name: 'Tuvalu', iso2: 'TV', point: [179.2, -8.5] },
];
const index = placeIndex(PLACES);
const CONFIG = {
  id: 'us', links: { list: 'https://example.test/list' }, home: 'us', territories: [],
  coveredBy: { somaliland: 'Somalia' },
  listOnly: { 'French West Indies': 'frenchWestIndies' },
  aliases: { Burma: 'mm', 'Israel and Palestine': ['il', 'gaza'] },
};

describe('resolvePlaces', () => {
  test('uses an explicit alias', () => assert.deepEqual(resolvePlaces('Burma', CONFIG, index), { places: ['mm'] }));
  test('supports one title covering several places', () => assert.deepEqual(resolvePlaces('Israel and Palestine', CONFIG, index).places, ['il', 'gaza']));
  test('matches the place name automatically, ignoring accents and punctuation', () => {
    assert.deepEqual(resolvePlaces('France', CONFIG, index), { places: ['fr'] });
    assert.deepEqual(resolvePlaces('democratic republic of the congo', CONFIG, index), { places: ['cd'] });
  });
  test('matches the map shape name too', () => assert.deepEqual(resolvePlaces('Dem. Rep. Congo', CONFIG, index), { places: ['cd'] }));
  test('returns list-only entries with their note key', () => assert.deepEqual(resolvePlaces('French West Indies', CONFIG, index), { places: [], noteKey: 'frenchWestIndies' }));
  test('returns null for an unknown title', () => assert.equal(resolvePlaces('Atlantis', CONFIG, index), null));
});

describe('checkPlaces', () => {
  const shapes = new Set(['France', 'Myanmar']);
  test('accepts places whose shapes exist, and points', () => {
    assert.deepEqual(checkPlaces([PLACES[0], PLACES[1], PLACES.at(-1)], shapes), []);
  });
  test('reports unknown shapes, missing geometry and duplicate ids', () => {
    const problems = checkPlaces([PLACES[0], { id: 'fr', name: 'Dup', shape: 'France' }, { id: 'x', name: 'X', shape: 'Nowhere' }, { id: 'y', name: 'Y' }], shapes);
    assert.equal(problems.length, 3);
  });
});

describe('isMinorChange with each provider\'s rules', () => {
  const cases = [
    [ca, 'Health – editorial change', true],
    [ca, 'Editorial change', true],
    [ca, 'The Health section was updated - travel health information (Public Health Agency of Canada)', true],
    [ca, 'Health – editorial change; Editorial change', true],
    [ca, 'Health – editorial change; Risk levels section – avoid non-essential travel to Baja California Sur', false],
    [ca, 'Risk levels section – avoid all travel to Afar', false],
    [us, 'Reissued after periodic review without changes.', true],
    [us, 'Reissued after periodic review with minor edits.', true],
    [us, 'Reissued with obsolete COVID-19 page links removed.', true],
    [us, 'There were no changes to the advisory level or risk indicators. Advisory summary was updated.', false],
    [us, 'The advisory level was increased to 4. The “health” indicator was added.', false],
  ];
  for (const [provider, text, minor] of cases) {
    test(`${provider.id} ${minor ? 'minor' : 'real'}: ${text.slice(0, 55)}`, () => assert.equal(isMinorChange(text, provider.minorChange), minor));
  }
});

describe('classifyUpdates', () => {
  test('trusts the source\'s own change type first (Canada)', () => {
    const list = [
      { updated: '2026-09-24', changeType: 'Editorial change', change: 'The Health section was updated - travel health information' },
      { updated: '2026-09-26', changeType: 'Regional advisory added', change: 'Risk levels section – avoid non-essential travel to Baja California Sur' },
      // A real change type wins even if the note text looks editorial.
      { updated: '2026-09-25', changeType: 'Regular text update', change: 'Editorial change' },
    ];
    classifyUpdates(list, ca.minorChange, ca.minorChangeTypes);
    assert.deepEqual(list.map(r => !!r.minorUpdate), [true, false, false]);
  });

  test('falls back to the note when there is no change type', () => {
    const list = [{ updated: '2026-09-24', change: 'Health – editorial change' }];
    classifyUpdates(list, ca.minorChange, ca.minorChangeTypes);
    assert.equal(list[0].minorUpdate, true);
  });

  test('uses the change note when there is one', () => {
    const list = [{ updated: '2026-09-24', change: 'Health – editorial change' }, { updated: '2026-09-24', change: 'Risk levels section – avoid all travel to Afar' }];
    classifyUpdates(list, ca.minorChange);
    assert.equal(list[0].minorUpdate, true);
    assert.equal(list[1].minorUpdate, undefined);
  });
  test('without notes, treats a date shared by over 40% of records as a bulk republish', () => {
    const list = [...Array.from({ length: 5 }, () => ({ updated: '2026-09-24' })), { updated: '2026-09-20' }, { updated: '2026-09-21' }];
    classifyUpdates(list, []);
    assert.equal(list.filter(r => r.minorUpdate).length, 5);
  });
});

describe('trackHistory', () => {
  test('records the first snapshot without reporting a change', () => {
    const history = {};
    const recs = [{ title: 'Chad', level: 3 }];
    trackHistory(history, 'us', '2026-09-26', recs);
    assert.deepEqual(history.us.Chad, [{ date: '2026-09-26', level: 3 }]);
    assert.equal(recs[0].levelChange, undefined);
  });
  test('records a later level change and reports it', () => {
    const history = { us: { Chad: [{ date: '2026-09-26', level: 3 }] } };
    const recs = [{ title: 'Chad', level: 4 }];
    trackHistory(history, 'us', '2026-09-27', recs);
    assert.deepEqual(recs[0].levelChange, { date: '2026-09-27', from: 3, to: 4 });
  });
  test('ignores a different level on the same day (no flapping)', () => {
    const history = { us: { Chad: [{ date: '2026-09-26', level: 3 }] } };
    trackHistory(history, 'us', '2026-09-26', [{ title: 'Chad', level: 4 }]);
    assert.equal(history.us.Chad.length, 1);
  });
});

describe('buildProvider', () => {
  const snapshot = {
    fetchedAt: '2026-09-26T12:00:00Z', source: 'https://example.test/api',
    entries: [
      { name: 'Burma', level: 4, updated: '2026-05-08', url: 'https://example.test/mm' },
      { name: 'Somalia', level: 4, updated: '2026-05-21' },
      { name: 'France', level: 2, updated: '2025-05-28', change: 'Reissued after periodic review without changes.' },
      { name: 'French West Indies', level: 1, updated: '2024-08-22' },
    ],
  };
  const run = (entries = snapshot.entries, config = CONFIG) =>
    buildProvider({ datasetId: 'travel-advisories', config, snapshot: { ...snapshot, entries }, minorChange: us.minorChange, index, history: {} });

  test('builds records that refer to places by id', () => {
    const { data, problems } = run();
    assert.deepEqual(problems, []);
    assert.equal(data.asOf, '2026-09-26');
    assert.deepEqual(data.records.find(r => r.title === 'Burma').places, ['mm']);
    assert.equal(data.records.find(r => r.title === 'France').minorUpdate, true);
    assert.equal(data.records.find(r => r.title === 'French West Indies').noteKey, 'frenchWestIndies');
  });
  test('publishes only record fields, never fetch bookkeeping (lastSeen, stamp, pending)', () => {
    const entries = [{ name: 'France', level: 2, updated: '2026-09-01', lastSeen: '2026-09-26', stamp: 's', pending: { level: 4, firstSeen: '2026-09-26' }, changeType: 'Editorial change', iso: 'FR' }];
    const [record] = run(entries).data.records;
    for (const field of ['lastSeen', 'stamp', 'pending', 'name', 'changeType', 'iso']) assert.equal(field in record, false, field);
  });

  test('attaches covered places to the covering record', () => {
    assert.deepEqual(run().data.records.find(r => r.title === 'Somalia').covers, ['somaliland']);
  });
  test('reports an advisory that matches no place', () => {
    assert.match(run([...snapshot.entries, { name: 'Atlantis', level: 1, updated: '2026-01-01' }]).problems.join(), /No place for "Atlantis"/);
  });
  test('reports a coveredBy rule whose advisory is missing', () => {
    assert.match(run(snapshot.entries.filter(e => e.name !== 'Somalia')).problems.join(), /coveredBy advisory "Somalia" not in data/);
  });
  test('reports an alias to an unknown place', () => {
    assert.match(run(snapshot.entries, { ...CONFIG, aliases: { Burma: 'nowhere' } }).problems.join(), /unknown place "nowhere"/);
  });
});

describe('buildSite', () => {
  const input = () => ({
    places: PLACES,
    shapeNames: new Set(PLACES.filter(p => p.shape).map(p => p.shape)),
    locales: ['en'],
    datasets: [{
      config: { id: 'travel-advisories', providers: ['us'], scale: { type: 'levels', values: [1, 2, 3, 4] }, recentWindows: [0, 30], defaultRecentWindow: 30 },
      providers: [{ config: { ...CONFIG, flag: 'us' }, minorChange: us.minorChange, snapshot: { fetchedAt: '2026-09-26T00:00:00Z', source: 's', entries: [{ name: 'France', level: 2, updated: '2026-09-01' }, { name: 'Somalia', level: 4, updated: '2026-09-01' }] } }],
    }],
    history: {},
  });

  test('produces the manifest, the place registry and one file per provider', () => {
    const { files, problems } = buildSite(input());
    assert.deepEqual(problems, []);
    assert.deepEqual(Object.keys(files).sort(), ['manifest.json', 'places.json', 'travel-advisories/us.json']);
    assert.deepEqual(files['manifest.json'].datasets[0].providers, [{ id: 'us', flag: 'us', asOf: '2026-09-26', file: 'travel-advisories/us.json' }]);
    assert.deepEqual(files['manifest.json'].locales, ['en']);
  });
  test('drops unset fields from published records', () => {
    const rec = buildSite(input()).files['travel-advisories/us.json'].records[0];
    assert.equal('change' in rec, false);
    assert.equal('regional' in rec, false);
  });
  test('reports a provider without a snapshot', () => {
    const i = input();
    i.datasets[0].providers[0].snapshot = null;
    assert.match(buildSite(i).problems.join(), /no snapshot yet/);
  });
  test('is deterministic', () => {
    assert.deepEqual(buildSite(input()).files, buildSite(input()).files);
  });
});
