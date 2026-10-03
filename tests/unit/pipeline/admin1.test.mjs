// The borders between states and provinces (scripts/tools/generate-admin1.mjs): which lines of
// Natural Earth's file are kept, and how, and that the published file is what the map needs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { admin1Lines, COUNTRIES } from '../../../scripts/tools/generate-admin1.mjs';

const line = (code, coordinates, type = 'LineString') => ({ type: 'Feature', properties: { ADM0_A3: code }, geometry: { type, coordinates } });

describe('admin1Lines', () => {
  test('keeps the chosen countries\' lines, by place id, rounded to 2 decimals', () => {
    const out = admin1Lines({ features: [
      line('USA', [[-100.123456, 40.987654], [-99.5, 41]]),
      line('CAN', [[[-110, 60], [-110, 49]], [[-120, 60], [-120, 54.001]]], 'MultiLineString'),
      line('BRA', [[-50, -10], [-51, -11]]),
    ] });
    assert.deepEqual(out, { us: [[[-100.12, 40.99], [-99.5, 41]]], ca: [[[-110, 60], [-110, 49]], [[-120, 60], [-120, 54]]] });
  });
  test('drops points that repeat once rounded, lines left with one point, and features without a line', () => {
    const out = admin1Lines({ features: [
      line('USA', [[-100.001, 40], [-100.002, 40.001], [-99, 41]]),
      line('USA', [[-90.001, 30], [-90.002, 30.001]]),
      { type: 'Feature', properties: { ADM0_A3: 'USA' }, geometry: null },
      line('USA', [[1, 1]], 'Point'),
    ] });
    assert.deepEqual(out, { us: [[[-100, 40], [-99, 41]]], ca: [] });
  });
  test('the U.S. and Canada for now', () => {
    assert.deepEqual(COUNTRIES, { USA: 'us', CAN: 'ca' });
  });
});

describe('site/data/geo/admin1-lines.json', () => {
  const file = JSON.parse(readFileSync(new URL('../../../site/data/geo/admin1-lines.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('../../../site/data/manifest.json', import.meta.url), 'utf8'));

  test('is named in the manifest, credits its source, and has both countries\' lines', () => {
    assert.equal(manifest.admin1, 'geo/admin1-lines.json');
    assert.match(file.source, /natural-earth/);
    assert.match(file.licence, /public domain/);
    assert.deepEqual(Object.keys(file.countries), ['us', 'ca']);
    assert.ok(file.countries.us.length > 80, `${file.countries.us.length} U.S. lines`);
    assert.ok(file.countries.ca.length > 10, `${file.countries.ca.length} Canadian lines`);
  });
  test('every line is in North America (or Hawaii), with at least two points', () => {
    for (const [id, lines] of Object.entries(file.countries)) {
      for (const l of lines) {
        assert.ok(l.length >= 2, id);
        for (const [lon, lat] of l) assert.ok(lon >= -180 && lon <= -50 && lat >= 18 && lat <= 84, `${id}: ${lon}, ${lat}`);
      }
    }
  });
});
