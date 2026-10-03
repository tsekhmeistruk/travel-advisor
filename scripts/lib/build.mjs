// Pure build logic: turns provider snapshots into the published site data. No file access
// here (see scripts/build.mjs and lib/store.mjs), so tests can run it directly.
//
// Published files (site/data/):
//   manifest.json                   datasets, their providers and files, available locales
//   places.json                     the place registry (copied from config/places.json)
//   <dataset>/<provider>.json       one provider's records, each referring to places by id
//
// The shapes are deliberately flat and id-based, like database tables; see docs/architecture.md.

import { nameKey } from './text.mjs';

// ---- places

/**
 * Lookups over the place registry: by id, by ISO code (alpha-2 or alpha-3), and by
 * spelling-insensitive name or map shape.
 */
export function placeIndex(places) {
  const byId = new Map(places.map(p => [p.id, p]));
  const byKey = new Map();
  const byCode = new Map();
  for (const p of places) {
    byKey.set(nameKey(p.name), p.id);
    if (p.shape) byKey.set(nameKey(p.shape), p.id);
    if (p.iso2) byCode.set(p.iso2, p.id);
    if (p.iso3) byCode.set(p.iso3, p.id);
  }
  return { byId, byKey, byCode };
}

/**
 * Which places a provider's advisory refers to, from its title and (optional) country code.
 * Order: the provider's list-only entries and title aliases, its code aliases (for codes
 * that aren't a single place, e.g. "PSE" or "BQ-SA"), then automatic matches on the ISO
 * code and on the place's name or map shape name. Returns null if nothing matches.
 */
export function resolvePlaces(title, providerConfig, index, code) {
  if (providerConfig.listOnly?.[title]) return { places: [], noteKey: providerConfig.listOnly[title] };
  const alias = providerConfig.aliases?.[title] ?? (code && providerConfig.codes?.[code]);
  if (alias) return { places: [].concat(alias) };
  const id = (code && index.byCode.get(code.toUpperCase())) || index.byKey.get(nameKey(title));
  return id ? { places: [id] } : null;
}

/** Problems with the registry itself: every shape must exist on the map. */
export function checkPlaces(places, shapeNames) {
  const problems = [];
  const ids = new Set();
  for (const p of places) {
    if (ids.has(p.id)) problems.push(`Duplicate place id "${p.id}"`);
    ids.add(p.id);
    if (!p.shape && !p.point) problems.push(`Place "${p.id}" has neither a shape nor a point`);
    if (p.shape && !shapeNames.has(p.shape)) problems.push(`Place "${p.id}" refers to unknown map shape "${p.shape}"`);
  }
  return problems;
}

// ---- level history

// How many past level changes a record carries (the details card lists them).
export const MAX_LEVEL_CHANGES = 3;

/**
 * The level history is the only source of "what changed": a pulse on the map means the level
 * went up or down, nothing else. `history[providerId][title]` (mutated) lists observations
 * { date, level }: the first snapshot that had the advisory, then every snapshot that saw a
 * different level. A different level on the same date is ignored, so one bad response can't
 * flap the history.
 *
 * Only what our own snapshots saw is in a log: what a source says about its past (a change
 * note, an "updated" date) never is.
 *
 * Sets record.levelChanges ({ date, from, to, up }, newest first) and record.trackedSince
 * (the first snapshot that had the advisory).
 */
export function trackHistory(history, providerId, asOf, records) {
  const book = (history[providerId] ??= {});
  for (const r of records) {
    const log = (book[r.title] ??= []);
    const last = log.at(-1);
    if (!last || (last.level !== r.level && asOf > last.date)) log.push({ date: asOf, level: r.level });

    const changes = levelChangesOf(log);
    if (changes.length) r.levelChanges = changes.reverse().slice(0, MAX_LEVEL_CHANGES);
    r.trackedSince = log[0].date;
  }
}

/** Every level change in one advisory's log, oldest first: { date, from, to, up }. */
export function levelChangesOf(log) {
  const changes = [];
  log.forEach((e, i) => {
    const prev = log[i - 1];
    if (prev && prev.level !== e.level) changes.push({ date: e.date, from: prev.level, to: e.level, up: e.level > prev.level });
  });
  return changes;
}

// ---- providers and the whole site

/**
 * Build one provider's published data.
 * @param snapshot  { fetchedAt, source, entries: [{ name, level, updated, url?, regional?, iso? }] }
 * @param config    config/providers/<id>.json
 * @param history   the dataset's history (mutated)
 */
export function buildProvider({ datasetId, config, snapshot, index, history }) {
  const problems = [];
  const tag = `[${config.id}]`;
  const asOf = snapshot.fetchedAt.slice(0, 10);

  const records = [];
  for (const e of snapshot.entries) {
    const resolved = resolvePlaces(e.name, config, index, e.iso);
    if (!resolved) { problems.push(`${tag} No place for "${e.name}": add it to aliases in config/providers/${config.id}.json`); continue; }
    for (const id of resolved.places) if (!index.byId.has(id)) problems.push(`${tag} "${e.name}" maps to unknown place "${id}"`);
    records.push({
      title: e.name,
      level: e.level,
      updated: e.updated,
      url: e.url,
      regional: e.regional || undefined,
      places: resolved.places,
      noteKey: resolved.noteKey,
    });
  }

  // "Covered by": places without an advisory of their own that fall under another one.
  const byTitle = new Map(records.map(r => [r.title, r]));
  for (const [placeId, title] of Object.entries(config.coveredBy ?? {})) {
    const record = byTitle.get(title);
    if (!index.byId.has(placeId)) problems.push(`${tag} coveredBy refers to unknown place "${placeId}"`);
    if (!record) { problems.push(`${tag} coveredBy advisory "${title}" not in data`); continue; }
    (record.covers ??= []).push(placeId);
  }
  for (const id of [config.home, ...(config.territories ?? [])]) {
    if (id && !index.byId.has(id)) problems.push(`${tag} home/territory refers to unknown place "${id}"`);
  }

  trackHistory(history, config.id, asOf, records);

  return {
    problems,
    data: {
      dataset: datasetId,
      provider: config.id,
      asOf,
      source: snapshot.source,
      links: config.links,
      home: config.home,
      territories: config.territories ?? [],
      records,
    },
  };
}

/**
 * Build every published file.
 * @param input {
 *   places, shapeNames: Set, locales: ['en', ...],
 *   datasets: [{ config, providers: [{ config, snapshot | null }] }],
 *   history: { [datasetId]: history }   (mutated)
 * }
 * @returns { files: { [relPath]: data }, problems }
 */
export function buildSite({ places, shapeNames, locales, datasets, history }) {
  const problems = checkPlaces(places, shapeNames);
  const index = placeIndex(places);
  const files = { 'places.json': places };
  const manifest = { defaultLocale: 'en', locales, places: 'places.json', geo: 'geo/countries-50m.json', datasets: [] };

  for (const { config: ds, providers } of datasets) {
    const entry = { id: ds.id, scale: ds.scale, recentWindows: ds.recentWindows, defaultRecentWindow: ds.defaultRecentWindow, providers: [] };
    const dsHistory = (history[ds.id] ??= {});
    for (const { config, snapshot } of providers) {
      if (!snapshot) { problems.push(`[${config.id}] no snapshot yet: run node scripts/fetch.mjs ${config.id}`); continue; }
      const built = buildProvider({ datasetId: ds.id, config, snapshot, index, history: dsHistory });
      problems.push(...built.problems);
      const file = `${ds.id}/${config.id}.json`;
      files[file] = built.data;
      entry.providers.push({ id: config.id, flag: config.flag, asOf: built.data.asOf, file });
    }
    manifest.datasets.push(entry);
  }

  files['manifest.json'] = manifest;
  // JSON round trip drops undefined fields, so published files carry only what's set.
  return { files: JSON.parse(JSON.stringify(files)), problems };
}
