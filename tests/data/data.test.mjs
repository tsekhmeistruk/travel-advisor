// Validates the published site data (site/data/), the configuration it's built from, and the
// translation files. Runs before every deploy, so a bad fetch, a config mistake or a forgotten
// rebuild never reaches the live site.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FileStore } from '../../scripts/lib/store.mjs';
import { readBuildInput, buildAll } from '../../scripts/build.mjs';
import { SPLIT_SHAPE_NAMES } from '../../site/js/map/splits.js';
import { rank } from '../../scripts/lib/anomaly.mjs';
import { travelLevel } from '../../scripts/lib/risk.mjs';
import { validatePublish } from '../../scripts/lib/validate.mjs';

const store = new FileStore();
const manifest = store.published('manifest.json');
const places = store.places();
const placeIds = new Set(places.map(p => p.id));
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// The first snapshot of the level history: nothing we observed is older.
const HISTORY_BEGAN = '2026-09-26';

describe('published data is up to date', () => {
  const built = buildAll(readBuildInput(store));

  test('every file in site/data matches a fresh build of config/ and data/', () => {
    assert.deepEqual(built.problems, []);
    for (const [path, expected] of Object.entries(built.files)) {
      assert.deepEqual(store.published(path), expected, `${path} is out of date: run \`npm run build\` and commit the result.`);
    }
  });

  // The backend has no test gate between a fetch and the live site: it runs this check itself.
  test('the build passes the checks the backend makes before it publishes', () => {
    assert.deepEqual(validatePublish(built.files, (path) => store.published(path)), []);
  });

  test('the risk signals and change log already include this data', () => {
    assert.deepEqual(built.newChanges, [], 'changes missing from data/changes/: run `npm run build` and commit the result.');
    assert.deepEqual(built.state, store.signals(), 'data/signals/current.json is out of date: run `npm run build`.');
  });
});

describe('risk data', () => {
  const risk = (name) => store.published(manifest.risk[name]);
  const { categories: catConfig, scale } = store.categories();
  const categoryIds = new Set(catConfig.map(c => c.id));
  const levels = new Set(scale.values);
  const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

  test('the manifest points at every risk file', () => {
    for (const name of ['current', 'changes', 'events', 'health', 'conflict', 'conflictEvents', 'wars']) assert.ok(risk(name), name);
    assert.equal(manifest.risk.conflictEvents, 'risk/conflict-events.json');
    assert.match(manifest.risk.asOf, ISO_TIME);
  });

  test('every source behind the levels is named with a link, for attribution', () => {
    const { sources, categories } = risk('current');
    for (const id of Object.values(categories).flatMap(c => c.sources)) assert.match(sources[id]?.url ?? '', /^https:\/\//, `${id}: link`);
  });

  test('signals are on known places and categories, at known levels, with known facts as basis', () => {
    const current = risk('current');
    const eventIds = new Set(store.sourceIds().flatMap(id => (store.events(id)?.events ?? []).map(e => e.id)));
    // A conflict level's basis is its source's data month (e.g. "ucdp:2026-08").
    for (const id of store.sourceIds().filter(s => store.source(s).kind === 'conflict')) eventIds.add(`${id}:${store.conflict(id).versions.at(-1).month}`);
    for (const c of Object.keys(current.categories)) assert.ok(categoryIds.has(c), `category ${c}`);
    for (const [id, signals] of Object.entries(current.places)) {
      assert.ok(placeIds.has(id), `unknown place ${id}`);
      for (const [c, s] of Object.entries(signals)) {
        assert.ok(current.categories[c], `${id}: category ${c} not listed`);
        assert.ok(levels.has(s.level), `${id}/${c}: level ${s.level}`);
        for (const b of s.basis ?? []) assert.ok(eventIds.has(b), `${id}/${c}: basis ${b} is not a stored event`);
      }
      if (signals.travel) assert.equal(signals.travel.level, travelLevel(signals.travel.natives), `${id}: travel is the level two or more governments give`);
    }
  });

  test('changes are unique, newest first, inside the window, on known places', () => {
    const { changes, windowDays } = risk('changes');
    const ids = new Set();
    const oldest = new Date(Date.parse(manifest.risk.asOf) - windowDays * 864e5).toISOString().slice(0, 10);
    changes.forEach((c, i) => {
      assert.ok(!ids.has(c.id), `duplicate change ${c.id}`);
      ids.add(c.id);
      assert.ok(['level', 'advisory', 'event', 'anomaly'].includes(c.kind), c.id);
      assert.ok(categoryIds.has(c.category), c.id);
      assert.ok(c.at >= oldest && c.at <= tomorrow + 'T', `${c.id} outside the window`);
      if (i > 0) assert.ok(c.at <= changes[i - 1].at, `${c.id}: changes must be newest first`);
      for (const id of [...(c.placeIds ?? []), ...(c.placeId ? [c.placeId] : [])]) assert.ok(placeIds.has(id), `${c.id}: unknown place ${id}`);
      // Levels compare as numbers; an anomaly's from/to are statuses (normal < above < far).
      const order = c.kind === 'anomaly' ? rank : (x) => x;
      if (c.kind === 'anomaly') assert.ok(['normal', 'above', 'far'].includes(c.from) && ['normal', 'above', 'far'].includes(c.to), `${c.id}: statuses`);
      if (c.from != null && c.to != null) assert.equal(c.up, order(c.to) > order(c.from), `${c.id}: direction`);
    });
  });

  test('events are active, placed on known places, with our level beside the source level', () => {
    for (const e of risk('events').events) {
      assert.match(e.id, /^[a-z]+:/, e.id);
      assert.ok(categoryIds.has(e.category), e.id);
      assert.ok(e.level == null || levels.has(e.level), e.id);
      assert.ok(e.native?.scheme && e.native.value, `${e.id}: native value`);
      for (const id of e.placeIds) assert.ok(placeIds.has(id), `${e.id}: unknown place ${id}`);
      if (e.url) assert.match(e.url, /^https:\/\//, e.id);
    }
  });

  test('every place has a place file, with only its own changes and events, and valid advisories', () => {
    const eventIds = new Set(risk('events').events.map(e => e.id));
    for (const id of placeIds) {
      const file = store.published(`${manifest.risk.places}${id}.json`);
      assert.ok(file, `no place file for ${id}`);
      assert.equal(file.placeId, id);
      for (const c of file.changes) assert.ok((c.placeIds ?? [c.placeId]).includes(id), `${id}: change ${c.id} is about another place`);
      for (const e of file.events) assert.ok(eventIds.has(e), `${id}: ${e} is not an active event`);
      for (const [p, a] of Object.entries(file.advisories)) {
        assert.ok(levels.has(a.level), `${id}/${p}: level`);
        if (a.url) assert.match(a.url, /^https:\/\//, `${id}/${p}: url`);
      }
    }
  });

  test('every scheduled provider and source has a health entry', () => {
    assert.deepEqual(Object.keys(risk('health').sources).sort(), Object.keys(store.schedule()).sort());
    for (const [id, h] of Object.entries(risk('health').sources)) assert.ok(['healthy', 'delayed', 'error'].includes(h.status), id);
  });
});

describe('tensions (news between countries)', () => {
  test('each pair above normal is on known places, keyed by its two sorted codes, and never a level', () => {
    const current = store.published(manifest.risk.current);
    const tensions = current.activity?.gdelt?.tensions;
    if (!tensions) return;
    for (const [key, t] of Object.entries(tensions.pairs)) {
      const codes = key.split('|');
      assert.deepEqual(codes, [...codes].sort(), key);
      assert.ok(t.sides.length === 2 && t.sides.flat().every(id => placeIds.has(id)), `${key}: places`);
      assert.ok(['above', 'far'].includes(t.status) && t.count > t.expected, key);
    }
    assert.equal(Object.keys(current.categories).includes('tensions'), false);
  });
});

describe('conflict data', () => {
  for (const id of store.sourceIds().filter(s => store.source(s).kind === 'conflict')) {
    const config = store.source(id);
    const published = store.published(manifest.risk.conflict);
    const current = store.published(manifest.risk.current);

    test(`${id}: every country and government in the stored versions is mapped to a place`, () => {
      const { warnings } = buildAll(readBuildInput(store));
      assert.deepEqual(warnings.filter(w => w.startsWith(`[${id}] countries not in`)), [], 'add them to `countries` in the source config');
    });

    test(`${id}: the levels follow the deaths bands, and the war count lists the wars`, () => {
      assert.equal(published.source, id);
      assert.equal(published.series.months.at(-1), published.through);
      for (const [placeId, p] of Object.entries(published.places)) {
        assert.ok(placeIds.has(placeId), placeId);
        assert.equal(p.months.length, config.windowMonths, placeId);
        assert.equal(p.deaths12, p.months.reduce((a, b) => a + b, 0), `${placeId}: deaths12 is the sum of the months`);
        const band = config.bands.find(b => p.deaths12 >= b.minDeaths)?.level ?? 1;
        if (current.categories[config.category].status !== 'error') assert.equal(current.places[placeId]?.[config.category]?.level ?? 1, band, `${placeId}: level`);
      }
      const wars = Object.values(published.conflicts).filter(c => c.war);
      assert.equal(published.series.wars.at(-1), wars.length);
      assert.ok(wars.every(c => c.deaths12 >= published.warDeaths && c.places.length), 'wars have their deaths and places');
    });

    test(`${id}: every listed conflict names its two sides; a government on a side is a place and a party`, () => {
      for (const [key, c] of Object.entries(published.conflicts)) {
        assert.ok(c.sides.a.length && c.sides.b.length, `${key}: both sides`);
        for (const actor of [...c.sides.a, ...c.sides.b]) {
          assert.ok(actor.name === null || typeof actor.name === 'string', key);
          if (actor.place) assert.ok(placeIds.has(actor.place) && c.parties.includes(actor.place), `${key}: ${actor.name} is a party`);
          if (/^Government of /.test(actor.name ?? '')) assert.ok(actor.place, `${key}: ${actor.name} has no place: add it to \`countries\``);
        }
        assert.equal(c.months.length, config.windowMonths, key);
        assert.equal(c.deaths12, c.months.reduce((a, b) => a + b, 0), `${key}: deaths12 is the sum of its months`);
        assert.ok(c.civilians12 >= 0 && c.civilians12 <= c.deaths12, key);
        assert.match(c.first, /^\d{4}-\d\d$/, key);
      }
      for (const key of published.new) assert.ok(published.conflicts[key], `new ${key} is listed`);
      for (const q of published.quiet) assert.ok(q.deaths >= config.quiet.minDeaths && q.lastDeaths < published.through && q.parties.every(p => placeIds.has(p)), q.key);
    });

    test(`${id}: the context of the wars: each for a listed or quiet conflict, with a link, and countries by place`, () => {
      const wars = store.published(manifest.risk.wars);
      const quiet = new Set(published.quiet.map(q => q.key));
      assert.ok(Object.keys(wars.conflicts).length >= 10, 'most wars have an article');
      for (const [key, w] of Object.entries(wars.conflicts)) {
        assert.ok(published.conflicts[key] || quiet.has(key), key);
        assert.match(w.url, /^https:\/\/en\.wikipedia\.org\/wiki\//, key);
        assert.ok(w.extract.length > 50, `${key}: extract`);
        if (w.map) assert.match(w.map, /^https:\/\/en\.wikipedia\.org\/wiki\/File:/, key);
        for (const s of Object.values(w.sides ?? {})) assert.ok([...s.with, ...s.backers].every(p => placeIds.has(p)), `${key}: places`);
      }
      const ukraine = wars.conflicts['1:13243'];
      if (ukraine) assert.ok(ukraine.sides.a.with.includes('by'), 'Belarus with Russia (a check of the matching on real data)');
    });

    test(`${id}: the month's dots are in the latest month, on the map, each with its names`, () => {
      const dots = store.published(manifest.risk.conflictEvents);
      assert.equal(dots.through, published.through);
      assert.ok(dots.events.length > 100, `${dots.events.length} dots`);
      for (const [lat, lon, deaths, date, key, a, b, place] of dots.events) {
        assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && deaths > 0, key);
        assert.equal(date.slice(0, 7), dots.through);
        assert.ok(key in dots.conflicts && a in dots.actors && b in dots.actors, key);
        assert.ok(place === null || placeIds.has(place), place);
      }
    });
  }
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

      // A sanity check of the parsing, not of the world: a source may have no destination at some
      // level today (Germany has no level 2), but a spread from the lowest to the highest.
      test('has a plausible number of records, from the lowest level to the highest', () => {
        assert.ok(data.records.length >= 150, `only ${data.records.length} records`);
        const used = new Set(data.records.map(r => r.level));
        assert.ok(used.has(dataset.scale.values[0]) && used.has(dataset.scale.values.at(-1)), `levels used: ${[...used].sort()}`);
        assert.ok(used.size >= 3, `only levels ${[...used].sort()}`);
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

test('the level history holds only our own observations, in order', () => {
  for (const dataset of manifest.datasets) {
    for (const [provider, book] of Object.entries(store.history(dataset.id))) {
      for (const [title, log] of Object.entries(book)) {
        const where = `${dataset.id}/${provider}/${title}`;
        assert.ok(Array.isArray(log) && log.length > 0, where);
        log.forEach((e, i) => {
          // Only what our own snapshots saw: nothing a source said about its past (a change note).
          assert.deepEqual(Object.keys(e), ['date', 'level'], `${where}: an observation is { date, level }`);
          assert.match(e.date, ISO_DATE, where);
          assert.ok(e.date >= HISTORY_BEGAN, `${where}: no snapshot before tracking began`);
          assert.ok(dataset.scale.values.includes(e.level), where);
          if (i > 0) assert.ok(e.date > log[i - 1].date, `${where}: dates must increase`);
          if (i > 0) assert.notEqual(e.level, log[i - 1].level, `${where}: consecutive snapshots must differ`);
        });
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
