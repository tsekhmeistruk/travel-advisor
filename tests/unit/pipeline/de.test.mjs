import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWarnings, LEVEL_BY_FLAG } from '../../../scripts/providers/de/parse.mjs';

// A real response of the Foreign Office's open-data API, trimmed to 17 destinations: four with a
// travel warning, four with a partial one, eight without, and the Palestinian territories.
const FIXTURE = JSON.parse(readFileSync(new URL('../../fixtures/germany-warnings.json', import.meta.url), 'utf8'));
const destination = (flags = {}) => ({ response: { contentList: ['1'], 1: {
  countryName: 'Testland', iso3CountryCode: 'TST', countryCode: 'TS', lastModified: 1757063288,
  warning: false, partialWarning: false, situationWarning: false, situationPartWarning: false, ...flags,
} } });

describe('parseWarnings on a real response', () => {
  const entries = parseWarnings(FIXTURE);
  test('reads every destination with its German name, ISO code, level and date, sorted by name', () => {
    assert.equal(entries.length, 17);
    assert.deepEqual(entries.map(e => e.name), [...entries.map(e => e.name)].sort((a, b) => a.localeCompare(b)));
    assert.ok(entries.every(e => /^[A-Z]{3}$/.test(e.iso) && /^\d{4}-\d{2}-\d{2}$/.test(e.updated)));
    assert.deepEqual(entries.map(e => e.level).sort().filter((l, i, a) => a.indexOf(l) === i), [1, 3, 4]);
  });
  test('a partial warning is regional; a full warning and no warning are not', () => {
    for (const e of entries) assert.equal(e.regional, e.level === 3 ? true : undefined, e.name);
  });
  test('the Palestinian territories come with the code PSE (two places, mapped in config)', () => {
    assert.equal(entries.find(e => e.iso === 'PSE').level, 4);
  });
});

describe('levels from the flags', () => {
  test('maps each flag; the most severe sets the level; advice against the whole country is not regional', () => {
    const one = (flags) => parseWarnings(destination(flags))[0];
    assert.deepEqual([one({}).level, one({}).regional], [1, undefined]);
    assert.deepEqual([one({ situationPartWarning: true }).level, one({ situationPartWarning: true }).regional], [2, true]);
    assert.deepEqual([one({ partialWarning: true }).level, one({ partialWarning: true }).regional], [3, true]);
    assert.deepEqual([one({ situationWarning: true }).level, one({ situationWarning: true }).regional], [3, undefined]);
    assert.deepEqual([one({ warning: true, partialWarning: true }).level, one({ warning: true, partialWarning: true }).regional], [4, undefined]);
    assert.equal(one({}).updated, '2025-09-05');
    assert.deepEqual(Object.values(LEVEL_BY_FLAG).sort(), [2, 3, 3, 4]);
  });
  test('rejects a response without a list, or a destination without name, code or date', () => {
    assert.throws(() => parseWarnings({}), /no list of destinations/);
    assert.throws(() => parseWarnings(destination({ iso3CountryCode: '' })), /without name, code or date/);
  });
});
