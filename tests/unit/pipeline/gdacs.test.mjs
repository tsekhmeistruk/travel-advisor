import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEvents, parseFeature, utc, SCHEME } from '../../../scripts/providers/gdacs/parse.mjs';

// A real response of the search endpoint: Orange and Red alerts of 30 days.
const FIXTURE = readFileSync(new URL('../../fixtures/gdacs-search.json', import.meta.url), 'utf8');
const feature = (props = {}, geometry = { type: 'Point', coordinates: [-105.123456, 18.5] }) => ({
  type: 'Feature', geometry,
  properties: {
    eventtype: 'TC', eventid: 1001325, episodeid: 28, name: 'Tropical Cyclone X', alertlevel: 'Orange', country: 'Mexico',
    iso3: '', affectedcountries: [{ iso3: 'MEX' }], fromdate: '2026-09-21T03:00:00', todate: '2026-09-27T15:00:00',
    datemodified: '2026-09-27T15:26:08', iscurrent: 'true', url: { report: 'https://www.gdacs.org/report.aspx?eventid=1001325' },
    severitydata: { severitytext: 'Hurricane' }, ...props,
  },
});

describe('parseEvents on a real response', () => {
  const events = parseEvents(FIXTURE);

  test('reads every event, with a unique id', () => {
    assert.equal(events.length, 13);
    assert.equal(new Set(events.map(e => e.id)).size, events.length);
    assert.ok(events.every(e => /^gdacs:(EQ|TC|FL|VO|DR|WF):\d+$/.test(e.id)));
  });

  test('keeps the source level as a native value, never as our level', () => {
    for (const e of events) {
      assert.equal(e.native.scheme, SCHEME);
      assert.ok(['Orange', 'Red'].includes(e.native.value), e.id);
      assert.equal(e.level, undefined, 'our level is set in the build, not here');
    }
  });

  test('reads dates as UTC, countries by alpha-3 code, and a rounded position', () => {
    const tc = events.find(e => e.id === 'gdacs:TC:1001325');
    assert.equal(tc.startedAt, '2026-09-21T03:00:00.000Z');
    assert.equal(tc.current, true);
    assert.deepEqual(tc.iso3, ['MEX']);
    assert.ok(Number.isFinite(tc.point.lon) && Number.isFinite(tc.point.lat));
    assert.match(tc.url, /^https:\/\/www\.gdacs\.org\/report\.aspx/);
    const drought = events.find(e => e.id === 'gdacs:DR:1018332');
    assert.ok(drought.iso3.length > 20, 'a drought spans many countries');
    assert.equal(drought.current, false);
  });

  test('leaves out fields that change on every request', () => {
    assert.ok(events.every(e => !('datemodified' in e) && !('icon' in e)));
  });
});

describe('parseFeature', () => {
  test('merges the top-level code with the affected countries, without duplicates', () => {
    assert.deepEqual(parseFeature(feature({ iso3: 'MEX', affectedcountries: [{ iso3: 'MEX' }, { iso3: 'GTM' }] })).iso3, ['MEX', 'GTM']);
    assert.deepEqual(parseFeature(feature({ affectedcountries: [] })).iso3, [], 'offshore');
    assert.deepEqual(parseFeature(feature({ affectedcountries: undefined })).iso3, []);
  });
  test('rounds the position and tolerates a missing one', () => {
    assert.deepEqual(parseFeature(feature()).point, { lon: -105.123, lat: 18.5 });
    assert.equal(parseFeature(feature({}, null)).point, undefined);
  });
  test('falls back to the event name or code when there is no display name', () => {
    assert.equal(parseFeature(feature({ name: '', eventname: 'NOLO-26' })).name, 'NOLO-26');
    assert.equal(parseFeature(feature({ name: '' })).name, 'TC 1001325');
    assert.equal(parseFeature(feature({ country: '' })).country, undefined);
    assert.equal(parseFeature(feature({ iscurrent: 'false' })).current, false);
  });
  test('rejects an event without its key fields', () => {
    for (const key of ['eventtype', 'eventid', 'alertlevel', 'fromdate', 'todate']) {
      assert.throws(() => parseFeature(feature({ [key]: '' })), new RegExp(`without ${key}`));
    }
    assert.throws(() => parseFeature(null), /without eventtype/);
  });
});

describe('response shapes', () => {
  test('an empty body (HTTP 204) means no events', () => assert.deepEqual(parseEvents('  '), []));
  test('rejects non-JSON and JSON without features', () => {
    assert.throws(() => parseEvents('<html>'), /not JSON/);
    assert.throws(() => parseEvents('{"type":"FeatureCollection"}'), /no list of features/);
  });
  test('reads zoneless times as UTC and keeps explicit zones', () => {
    assert.equal(utc('2026-09-27T15:00:00'), '2026-09-27T15:00:00.000Z');
    assert.equal(utc('2026-09-27T15:00:00+02:00'), '2026-09-27T13:00:00.000Z');
    assert.throws(() => utc('soon'), /is not a date/);
  });
});
