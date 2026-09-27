// Validates the published site data (site/data/), the configuration it's built from, and the
// translation files. Runs before every deploy, so a bad fetch, a config mistake or a forgotten
// rebuild never reaches the live site.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSite } from '../../scripts/lib/build.mjs';
import { FileStore } from '../../scripts/lib/store.mjs';
import { readBuildInput } from '../../scripts/build.mjs';
import { SPLIT_SHAPE_NAMES } from '../../site/js/map/splits.js';

const store = new FileStore();
const manifest = store.published('manifest.json');
const places = store.places();
const placeIds = new Set(places.map(p => p.id));
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('published data is up to date', () => {
  test('every file in site/data matches a fresh build of config/ and data/', () => {
    const input = readBuildInput(store);
    const { files, problems } = buildSite(input);
    assert.deepEqual(problems, []);
    for (const [path, expected] of Object.entries(files)) {
      assert.deepEqual(store.published(path), expected, `${path} is out of date: run \`npm run build\` and commit the result.`);
    }
  });
});

describe('place registry', () => {
  test('has unique ids, names, and a shape or point for every place', () => {
    assert.ok(places.length > 240, `${places.length} places`);
    assert.equal(placeIds.size, places.length, 'duplicate ids');
    for (const p of places) {
      assert.match(p.id, /^[a-z0-9-]+$/, p.id);
      assert.ok(p.name, p.id);
      assert.ok(p.shape || p.point, p.id);
      if (p.iso2) assert.match(p.iso2, /^[A-Z]{2}$/, p.id);
      if (p.iso2) assert.match(p.iso3 ?? '', /^[A-Z]{3}$/, `${p.id}: every ISO place also has its alpha-3 code`);
      if (p.iso3) assert.ok(p.iso2, `${p.id}: iso3 without iso2`);
    }
  });
  test('includes every shape the map splits out', () => {
    const shapes = new Set(places.map(p => p.shape));
    assert.deepEqual(SPLIT_SHAPE_NAMES.filter(s => !shapes.has(s)), []);
  });
});

describe('manifest', () => {
  test('lists available locales, including the default', () => {
    assert.ok(manifest.locales.includes(manifest.defaultLocale));
    assert.deepEqual(manifest.locales, store.locales());
  });
  test('points at files that exist', () => {
    for (const d of manifest.datasets) for (const p of d.providers) assert.ok(store.published(p.file), p.file);
    assert.ok(store.published(manifest.places));
    assert.ok(store.published(manifest.geo));
  });
});

for (const dataset of manifest.datasets) {
  for (const entry of dataset.providers) {
    describe(`${dataset.id} / ${entry.id}`, () => {
      const data = store.published(entry.file);

      test('has a plausible number of records at every level', () => {
        assert.ok(data.records.length >= 150, `only ${data.records.length} records`);
        for (const level of dataset.scale.values) assert.ok(data.records.some(r => r.level === level), `no level ${level}`);
      });

      test('every record is well formed', () => {
        const titles = new Set();
        for (const r of data.records) {
          const where = `${entry.id}/${r.title}`;
          assert.ok(!titles.has(r.title), `duplicate ${where}`);
          titles.add(r.title);
          assert.ok(dataset.scale.values.includes(r.level), `bad level in ${where}`);
          assert.match(r.updated, ISO_DATE, `bad date in ${where}`);
          assert.ok(r.updated <= tomorrow, `future date in ${where}`);
          if (r.url) assert.match(r.url, /^https:\/\//, `bad url in ${where}`);
          assert.ok(r.places.length || r.noteKey, `no place for ${where}`);
          for (const id of [...r.places, ...(r.covers ?? [])]) assert.ok(placeIds.has(id), `unknown place ${id} in ${where}`);
          assert.match(r.trackedSince ?? '', ISO_DATE, `no trackedSince in ${where}`);
          const changes = r.levelChanges ?? [];
          assert.ok(changes.length <= 3, `too many level changes in ${where}`);
          assert.equal(changes[0]?.to ?? r.level, r.level, `latest change must end at the current level in ${where}`);
          changes.forEach((c, i) => {
            assert.match(c.date, ISO_DATE, where);
            assert.ok(c.date <= tomorrow, `future level change in ${where}`);
            if (i > 0) assert.ok(c.date < changes[i - 1].date, `level changes must be newest first in ${where}`);
            if (c.from !== null) assert.equal(c.up, c.to > c.from, `direction of ${where}`);
            assert.equal(typeof c.up, 'boolean', where);
          });
        }
      });

      test('home and territories are known places', () => {
        for (const id of [data.home, ...data.territories]) assert.ok(placeIds.has(id), id);
      });
    });
  }
}

test('level history is well formed', () => {
  for (const dataset of manifest.datasets) {
    for (const [provider, book] of Object.entries(store.history(dataset.id))) {
      for (const [title, log] of Object.entries(book)) {
        const where = `${dataset.id}/${provider}/${title}`;
        assert.ok(Array.isArray(log) && log.length > 0, where);
        const seeds = log.filter(e => e.source);
        const observed = log.filter(e => !e.source);
        assert.ok(observed.length > 0, `${where}: at least one snapshot`);
        assert.deepEqual(log, [...seeds, ...observed], `${where}: announced changes come before the first snapshot`);
        log.forEach((e, i) => {
          assert.match(e.date, ISO_DATE, where);
          assert.ok(dataset.scale.values.includes(e.level), where);
          if (i > 0) assert.ok(e.date > log[i - 1].date, `${where}: dates must increase`);
        });
        observed.forEach((e, i) => {
          if (i > 0) assert.notEqual(e.level, observed[i - 1].level, `${where}: consecutive snapshots must differ`);
        });
        for (const e of seeds) {
          assert.equal(e.source, 'note', where);
          assert.equal(typeof e.up, 'boolean', where);
          if (e.from !== null) assert.equal(e.up, e.level > e.from, `${where}: direction matches from → to`);
        }
      }
    }
  }
});

describe('translations', () => {
  const keys = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) && !('one' in v || 'other' in v) ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
  const en = store.locale('en');

  test('every locale has exactly the keys of English (places may differ)', () => {
    const base = keys(en).filter(k => !k.startsWith('places.')).sort();
    for (const code of store.locales()) {
      const other = keys(store.locale(code)).filter(k => !k.startsWith('places.')).sort();
      assert.deepEqual(other, base, `${code}.json keys differ from en.json`);
    }
  });

  test('every provider has names, an agency and all levels, and every note a record uses', () => {
    for (const code of store.locales()) {
      const messages = store.locale(code);
      for (const dataset of manifest.datasets) {
        for (const entry of dataset.providers) {
          const p = messages.datasets?.[dataset.id]?.providers?.[entry.id];
          assert.ok(p?.name && p?.short && p?.agency, `${code}: provider ${entry.id}`);
          for (const level of dataset.scale.values) {
            assert.ok(p.levels?.[level]?.name && p.levels[level].short && p.levels[level].desc, `${code}: ${entry.id} level ${level}`);
          }
          for (const r of store.published(entry.file).records.filter(x => x.noteKey)) {
            assert.ok(p.notes?.[r.noteKey], `${code}: ${entry.id} note ${r.noteKey}`);
          }
        }
      }
    }
  });

  test('place-name overrides refer to known places', () => {
    for (const code of store.locales()) {
      for (const id of Object.keys(store.locale(code).places ?? {})) assert.ok(placeIds.has(id), `${code}: places.${id}`);
    }
  });
});
