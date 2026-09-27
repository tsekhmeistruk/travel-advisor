import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  placeIndex, resolvePlaces, checkPlaces, trackHistory, buildProvider, buildSite, MAX_LEVEL_CHANGES,
} from '../../../scripts/lib/build.mjs';

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

  describe('by country code', () => {
    const coded = placeIndex([...PLACES.map(p => (p.iso2 ? { ...p, iso3: { FR: 'FRA', MM: 'MMR', SO: 'SOM', CD: 'COD', IL: 'ISR', US: 'USA', TV: 'TUV' }[p.iso2] } : p))]);
    const cfg = { id: 'nl', codes: { PSE: ['gaza', 'west-bank'] }, aliases: { 'Birma (Myanmar)': 'mm' } };
    test('matches ISO alpha-2 and alpha-3 codes, whatever the title says', () => {
      assert.deepEqual(resolvePlaces('Frankrijk', cfg, coded, 'FRA'), { places: ['fr'] });
      assert.deepEqual(resolvePlaces('Frankrijk', cfg, coded, 'fr'), { places: ['fr'] });
    });
    test('uses code aliases for codes that are not one place', () => {
      assert.deepEqual(resolvePlaces('Palestijnse Gebieden', cfg, coded, 'PSE'), { places: ['gaza', 'west-bank'] });
    });
    test('a title alias wins over the code', () => {
      assert.deepEqual(resolvePlaces('Birma (Myanmar)', cfg, coded, 'XXX'), { places: ['mm'] });
    });
    test('falls back to the name when the code is unknown', () => {
      assert.deepEqual(resolvePlaces('Somalia', cfg, coded, 'ZZZ'), { places: ['so'] });
      assert.equal(resolvePlaces('Nergensland', cfg, coded, 'ZZZ'), null);
    });
  });
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

describe('trackHistory', () => {
  const run = (log, asOf, level) => {
    const history = { us: log ? { Chad: log } : {} };
    const record = { title: 'Chad', level };
    trackHistory(history, 'us', asOf, [record]);
    return { log: history.us.Chad, record };
  };

  test('records the first snapshot without reporting a change', () => {
    const { log, record } = run(null, '2026-09-26', 3);
    assert.deepEqual(log, [{ date: '2026-09-26', level: 3 }]);
    assert.equal(record.levelChanges, undefined);
    assert.equal(record.trackedSince, '2026-09-26');
  });
  test('records a raised level and reports it', () => {
    const { record } = run([{ date: '2026-09-26', level: 3 }], '2026-09-27', 4);
    assert.deepEqual(record.levelChanges, [{ date: '2026-09-27', from: 3, to: 4, up: true }]);
    assert.equal(record.trackedSince, '2026-09-26');
  });
  test('records a lowered level', () => {
    assert.deepEqual(run([{ date: '2026-09-26', level: 3 }], '2026-09-27', 1).record.levelChanges, [{ date: '2026-09-27', from: 3, to: 1, up: false }]);
  });
  test('the same level again adds nothing: only level changes are tracked', () => {
    const { log, record } = run([{ date: '2026-09-26', level: 3 }], '2026-10-05', 3);
    assert.equal(log.length, 1);
    assert.equal(record.levelChanges, undefined);
  });
  test('ignores a different level on the same day (no flapping)', () => {
    assert.equal(run([{ date: '2026-09-26', level: 3 }], '2026-09-26', 4).log.length, 1);
  });
  test(`reports the latest changes newest first, at most ${MAX_LEVEL_CHANGES}`, () => {
    const log = [1, 2, 3, 2, 1].map((level, i) => ({ date: `2026-01-0${i + 1}`, level }));
    const { record } = run(log, '2026-02-01', 1);
    assert.equal(record.levelChanges.length, MAX_LEVEL_CHANGES);
    assert.deepEqual(record.levelChanges.map(c => `${c.from}→${c.to}`), ['2→1', '3→2', '2→3']);
  });

  describe('changes the source announced before tracking began (seeded from U.S. notes)', () => {
    const seed = { date: '2026-04-28', level: 4, from: null, up: true, source: 'note' };
    test('are reported, with only the direction when the note gave no previous level', () => {
      const { log, record } = run([seed, { date: '2026-09-26', level: 4 }], '2026-09-27', 4);
      assert.equal(log.length, 2);
      assert.deepEqual(record.levelChanges, [{ date: '2026-04-28', from: null, to: 4, up: true }]);
      assert.equal(record.trackedSince, '2026-09-26', 'tracking starts at the first snapshot, not the seed');
    });
    test('a later observed change follows on from the seeded level', () => {
      const { record } = run([seed, { date: '2026-09-26', level: 4 }], '2026-10-02', 3);
      assert.deepEqual(record.levelChanges, [{ date: '2026-10-02', from: 4, to: 3, up: false }, { date: '2026-04-28', from: null, to: 4, up: true }]);
    });
    test('a seed alone still gets its first snapshot recorded', () => {
      const { log, record } = run([seed], '2026-09-26', 4);
      assert.deepEqual(log.at(-1), { date: '2026-09-26', level: 4 });
      assert.equal(record.trackedSince, '2026-09-26');
    });
  });
});

describe('buildProvider', () => {
  const snapshot = {
    fetchedAt: '2026-09-26T12:00:00Z', source: 'https://example.test/api',
    entries: [
      { name: 'Burma', level: 4, updated: '2026-05-08', url: 'https://example.test/mm' },
      { name: 'Somalia', level: 4, updated: '2026-05-21' },
      { name: 'France', level: 2, updated: '2025-05-28' },
      { name: 'French West Indies', level: 1, updated: '2024-08-22' },
    ],
  };
  const run = (entries = snapshot.entries, config = CONFIG) =>
    buildProvider({ datasetId: 'travel-advisories', config, snapshot: { ...snapshot, entries }, index, history: {} });

  test('builds records that refer to places by id', () => {
    const { data, problems } = run();
    assert.deepEqual(problems, []);
    assert.equal(data.asOf, '2026-09-26');
    assert.deepEqual(data.records.find(r => r.title === 'Burma').places, ['mm']);
    assert.equal(data.records.find(r => r.title === 'Burma').trackedSince, '2026-09-26');
    assert.equal(data.records.find(r => r.title === 'French West Indies').noteKey, 'frenchWestIndies');
  });
  test('publishes only record fields, never fetch bookkeeping or old change notes', () => {
    // Snapshots written before notes were dropped still carry change and changeType.
    const entries = [{ name: 'France', level: 2, updated: '2026-09-01', lastSeen: '2026-09-26', stamp: 's', pending: { level: 4, firstSeen: '2026-09-26' }, change: 'Editorial change', changeType: 'Editorial change', iso: 'FR' }];
    const [record] = run(entries).data.records;
    for (const field of ['lastSeen', 'stamp', 'pending', 'name', 'change', 'changeType', 'minorUpdate', 'iso']) assert.equal(field in record, false, field);
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
      providers: [{ config: { ...CONFIG, flag: 'us' }, snapshot: { fetchedAt: '2026-09-26T00:00:00Z', source: 's', entries: [{ name: 'France', level: 2, updated: '2026-09-01' }, { name: 'Somalia', level: 4, updated: '2026-09-01' }] } }],
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
    assert.equal('levelChanges' in rec, false);
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
