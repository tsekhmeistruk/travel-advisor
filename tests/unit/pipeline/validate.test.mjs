import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validatePublish, REQUIRED_RISK } from '../../../scripts/lib/validate.mjs';

/** A small build that passes: two places, one provider, every risk file. */
function build() {
  const riskFile = (name) => `risk/${name === 'conflictEvents' ? 'conflict-events' : name}.json`;
  const files = {
    'manifest.json': {
      places: 'places.json',
      datasets: [{ id: 'travel-advisories', scale: { values: [1, 2, 3, 4] }, providers: [{ id: 'us', file: 'travel-advisories/us.json' }] }],
      risk: { asOf: '2026-10-03T23:02:22.894Z', ...Object.fromEntries(REQUIRED_RISK.map(n => [n, riskFile(n)])), places: 'risk/places/' },
    },
    'places.json': [{ id: 'fr' }, { id: 'mx' }],
    'travel-advisories/us.json': { records: Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, level: 1 + (i % 4), places: ['fr'], covers: ['mx'] })) },
    'risk/places/fr.json': { placeId: 'fr' },
    'risk/places/mx.json': { placeId: 'mx' },
  };
  for (const name of REQUIRED_RISK) files[riskFile(name)] = {};
  files['risk/current.json'] = { scale: { values: [1, 2, 3, 4] }, places: { mx: { disaster: { level: 4 }, travel: { level: 2 } } } };
  files['risk/events.json'] = { events: [{ id: 'gdacs:TC:1', level: 4, placeIds: ['mx'] }, { id: 'usgs:1', level: null, placeIds: [] }] };
  return files;
}
const published = (records) => (path) => (path === 'travel-advisories/us.json' ? { records: Array(records).fill({}) } : null);

describe('validatePublish', () => {
  test('a whole build passes, on a first publish and after one of the same size', () => {
    assert.deepEqual(validatePublish(build()), []);
    assert.deepEqual(validatePublish(build(), published(10)), []);
    assert.deepEqual(validatePublish(build(), published(12)), [], '10 of 12 is over 80%');
  });

  test('no manifest or no places: nothing else is checked', () => {
    assert.deepEqual(validatePublish({}), ['manifest.json is missing']);
    const files = build();
    files['places.json'] = [];
    assert.deepEqual(validatePublish(files), ['places.json is missing or empty']);
    delete files['manifest.json'].places;
    assert.deepEqual(validatePublish(files), ['the places file is missing or empty']);
  });

  test('the manifest names every provider file and every risk file', () => {
    const files = build();
    delete files['travel-advisories/us.json'];
    delete files['risk/wars.json'];
    delete files['manifest.json'].risk.health;
    assert.deepEqual(validatePublish(files), ['travel-advisories/us.json is named by the manifest and missing', 'risk.health is not a published file', 'risk.wars is not a published file']);
    const none = build();
    delete none['manifest.json'].risk;
    delete none['manifest.json'].datasets;
    assert.equal(validatePublish(none).length, REQUIRED_RISK.length);
  });

  test('a provider with under 80% of the records published last is a bad fetch', () => {
    assert.deepEqual(validatePublish(build(), published(13)), ['travel-advisories/us.json: 10 records, 13 were published (under 80%)']);
  });

  test('every place id is known: records, signals, events, and each place has its file', () => {
    const files = build();
    files['travel-advisories/us.json'].records[0].places = ['atlantis'];
    files['travel-advisories/us.json'].records[1] = { title: 'No covers', level: 1, places: ['fr'] };
    files['risk/current.json'].places.xx = { disaster: { level: 2 } };
    files['risk/events.json'].events[0].placeIds = ['mx', 'yy'];
    delete files['risk/places/fr.json'];
    assert.deepEqual(validatePublish(files), [
      'travel-advisories/us.json: T0 is on the unknown place atlantis',
      'risk/current.json: unknown place xx',
      'risk/events.json: gdacs:TC:1 is on the unknown place yy',
      'risk/places/fr.json is missing',
    ]);
  });

  test('every level is on the scale: records, signals, events (an event may have none)', () => {
    const files = build();
    files['travel-advisories/us.json'].records[2].level = 5;
    files['risk/current.json'].places.mx.travel.level = 0;
    files['risk/events.json'].events[0].level = 7;
    assert.deepEqual(validatePublish(files), [
      'travel-advisories/us.json: T2 has level 5',
      'risk/current.json: mx/travel has level 0',
      'risk/events.json: gdacs:TC:1 has level 7',
    ]);
  });
});
