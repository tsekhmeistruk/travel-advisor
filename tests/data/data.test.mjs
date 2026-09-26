// Validates the generated site data (data/advisories.js, data/world.js) and its inputs.
// Runs before every deploy, so a bad fetch or a forgotten rebuild never reaches the live site.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildSources, mapNamesFrom, SPLIT_SHAPES } from '../../scripts/lib/build.mjs';
import { PATHS, readRawSources } from '../../scripts/build-data.mjs';

const read = (p) => readFileSync(p, 'utf8');
const repoFile = (rel) => new URL(`../../${rel}`, import.meta.url);

// Load a generated browser script and return what it assigns to window. The JSON round
// trip turns the sandbox's objects into this realm's, so deepStrictEqual compares values.
function loadWindowScript(path) {
  const sandbox = { window: {} };
  vm.runInNewContext(read(path), sandbox);
  return JSON.parse(JSON.stringify(sandbox.window));
}

const { ADVISORY_DATA } = loadWindowScript(PATHS.advisoriesJs);
const { WORLD_TOPO } = loadWindowScript(PATHS.worldJs);
const topo = JSON.parse(read(PATHS.world));
const mapNames = mapNamesFrom(topo);
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('generated data is up to date', () => {
  test('data/advisories.js matches a fresh build of data/sources and data/history.json', () => {
    const history = JSON.parse(read(PATHS.history));
    const { sources, problems } = buildSources(readRawSources(), history, mapNames);
    assert.deepEqual(problems, []);
    assert.deepEqual(JSON.parse(JSON.stringify(sources)), ADVISORY_DATA.sources,
      'Out of date: run `node scripts/build-data.mjs` and commit the result.');
  });

  test('data/world.js matches data/countries-50m.json', () => {
    assert.deepEqual(WORLD_TOPO, topo);
  });
});

for (const key of ['us', 'ca']) {
  describe(`source "${key}"`, () => {
    const src = ADVISORY_DATA.sources[key];

    test('is present with its metadata', () => {
      assert.ok(src, `missing source ${key}`);
      for (const field of ['label', 'agency', 'link', 'home', 'asOf', 'levels', 'coveredBy']) assert.ok(src[field], `missing ${field}`);
      assert.match(src.asOf, ISO_DATE);
      assert.deepEqual(Object.keys(src.levels).sort(), ['1', '2', '3', '4']);
    });

    test('has a plausible number of advisories at every level', () => {
      assert.ok(src.advisories.length >= 150, `only ${src.advisories.length} advisories`);
      for (const level of [1, 2, 3, 4]) {
        assert.ok(src.advisories.some(a => a.level === level), `no level ${level} advisories`);
      }
    });

    test('every advisory is well formed', () => {
      const names = new Set();
      for (const a of src.advisories) {
        const where = `${key}/${a.name}`;
        assert.equal(typeof a.name, 'string', where);
        assert.ok(!names.has(a.name), `duplicate advisory ${where}`);
        names.add(a.name);
        assert.ok([1, 2, 3, 4].includes(a.level), `bad level in ${where}`);
        assert.match(a.updated, ISO_DATE, `bad date in ${where}`);
        assert.ok(a.updated <= tomorrow, `future date ${a.updated} in ${where}`);
        if (a.url) assert.match(a.url, /^https:\/\//, `bad url in ${where}`);
        assert.ok(a.shapes || a.point || a.note, `no map placement for ${where}`);
        if (a.levelChange) assert.ok(a.levelChange.from !== a.levelChange.to, `empty level change in ${where}`);
      }
    });

    test('every shape exists on the map', () => {
      const missing = src.advisories.flatMap(a => (a.shapes || []).filter(s => !mapNames.has(s)).map(s => `${a.name} -> ${s}`));
      assert.deepEqual(missing, []);
    });

    test('every covered-by rule points at a shape and an advisory that exist', () => {
      const names = new Set(src.advisories.map(a => a.name));
      for (const [shape, adv] of Object.entries(src.coveredBy)) {
        assert.ok(mapNames.has(shape), `coveredBy shape ${shape}`);
        assert.ok(names.has(adv), `coveredBy advisory ${adv}`);
      }
    });
  });
}

test('level history is well formed', () => {
  const history = JSON.parse(read(PATHS.history));
  for (const [key, book] of Object.entries(history)) {
    for (const [name, log] of Object.entries(book)) {
      assert.ok(Array.isArray(log) && log.length > 0, `${key}/${name}`);
      for (let i = 0; i < log.length; i++) {
        assert.match(log[i].date, ISO_DATE, `${key}/${name}`);
        assert.ok([1, 2, 3, 4].includes(log[i].level), `${key}/${name}`);
        if (i > 0) {
          assert.ok(log[i].date > log[i - 1].date, `${key}/${name}: dates must increase`);
          assert.notEqual(log[i].level, log[i - 1].level, `${key}/${name}: consecutive entries must differ`);
        }
      }
    }
  }
});

test('the shapes js/app.js splits out match SPLIT_SHAPES in the build', () => {
  const app = read(repoFile('js/app.js'));
  const block = app.slice(app.indexOf('const SPLITS = {'), app.indexOf('};', app.indexOf('const SPLITS = {')));
  const split = [...block.matchAll(/name: '([^']+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(split, [...SPLIT_SHAPES].sort());
});
