// UCDP Candidate Events parsing, with real rows of version 26.0.8 (August 2026).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, parseVersion, nextVersion, versionMonth, versionFile } from '../../../scripts/providers/ucdp/parse.mjs';

const csv = readFileSync(new URL('../../fixtures/ucdp-ged.csv', import.meta.url), 'utf8');

describe('CSV', () => {
  test('quoted fields keep commas, quotes and line breaks', () => {
    assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n"two\nlines",,x\n'), [['a', 'b, c', 'say "hi"'], ['two\nlines', '', 'x']]);
    assert.deepEqual(parseCsv('a,b'), [['a', 'b']], 'no final newline');
  });
});

describe('a version', () => {
  const v = parseVersion(csv);

  test('keeps one slim row per event: id, date, country id, region, conflict and deaths', () => {
    assert.equal(v.events.length, 22);
    assert.equal(v.malformed, 0);
    const big = v.events.find(e => e[5] === 5017);
    assert.deepEqual(big.slice(1), ['2026-08-01', 369, '', '1:13243', 5017], 'Ukraine, a whole month reported at once');
    assert.ok(v.events.some(e => e[2] === 666 && e[3] === 'Gaza Strip'), 'the region is kept: the build places Gaza by it');
    assert.deepEqual(v.events.map(e => e[1]), [...v.events.map(e => e[1])].sort(), 'by date');
    assert.ok(v.events.some(e => e[1] < '2026-08'), 'a backdated event stays');
  });

  test('names the countries by id, and each conflict (by type and id) by its name and sides', () => {
    assert.equal(v.countries[369], 'Ukraine');
    assert.equal(v.countries[365], 'Russia (Soviet Union)');
    assert.deepEqual(v.conflicts['1:13243'], { name: 'Russia - Ukraine', sideA: 'Government of Russia (Soviet Union)', sideB: 'Government of Ukraine' });
    assert.deepEqual(v.conflicts['1:16905'].sideB, 'Government of Israel, Government of United States of America', 'two governments on one side');
    assert.match(v.conflicts[Object.keys(v.conflicts).find(k => k.startsWith('2:'))].name, /^XXX70/, 'a non-state conflict UCDP has not named yet');
  });

  test('a file without a header is read in the standard column order (v24.0.1 has none)', () => {
    const [header, ...rows] = csv.trim().split('\n');
    const headless = parseVersion(rows.join('\n'));
    assert.equal(headless.events.length, 22);
    assert.ok(header.startsWith('id,relid,'));
  });

  test('a header with an extra column (v24.0.10 starts with "#") is read by name', () => {
    const lines = csv.trim().split('\n');
    const shifted = [`"#",${lines[0]}`, ...lines.slice(1).map((l, i) => `${i + 1},${l}`)].join('\n');
    assert.deepEqual(parseVersion(shifted).events, v.events);
  });

  test('malformed rows are counted and left out; a file of another format fails', () => {
    const lines = csv.trim().split('\n');
    const broken = [...lines, lines[1].replace(/,\d+,\d+,\d+,(\d+,)?\d*$/, ',x,y'), 'too,short'].join('\n');
    const r = parseVersion(broken);
    assert.equal(r.events.length, 22);
    assert.equal(r.malformed, 2);
    assert.throws(() => parseVersion('a,b,c\n1,2,3\n'), /not in the expected format \(missing id/);
    assert.throws(() => parseVersion([lines[0], 'x,y'].join('\n')), /not in the expected format \(0 events, 1 malformed/);
  });
});

describe('versions', () => {
  test('one per month: the next one, its month and its file', () => {
    assert.equal(nextVersion('26.0.8'), '26.0.9');
    assert.equal(nextVersion('25.0.12'), '26.0.1', 'after December: the next year');
    assert.equal(versionMonth('26.0.8'), '2026-08');
    assert.equal(versionMonth('24.0.12'), '2024-12');
    assert.equal(versionFile('26.0.10'), 'GEDEvent_v26_0_10.csv');
  });
});
