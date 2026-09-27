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

/** Lookups over the place registry: by id, and by spelling-insensitive name or map shape. */
export function placeIndex(places) {
  const byId = new Map(places.map(p => [p.id, p]));
  const byKey = new Map();
  for (const p of places) {
    byKey.set(nameKey(p.name), p.id);
    if (p.shape) byKey.set(nameKey(p.shape), p.id);
  }
  return { byId, byKey };
}

/**
 * Which places a provider's advisory title refers to.
 * Order: the provider's list-only entries, its explicit aliases, then an automatic match
 * on the place's name or map shape name. Returns null if nothing matches.
 */
export function resolvePlaces(title, providerConfig, index) {
  if (providerConfig.listOnly?.[title]) return { places: [], noteKey: providerConfig.listOnly[title] };
  const alias = providerConfig.aliases?.[title];
  if (alias) return { places: [].concat(alias) };
  const id = index.byKey.get(nameKey(title));
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

// ---- update classification and history

/** True if every ';'-separated part of a change note matches one of the provider's minor patterns. */
export function isMinorChange(text, patterns) {
  const parts = text.split(/;\s*/).filter(Boolean);
  return parts.length > 0 && parts.every(p => patterns.some(re => re.test(p)));
}

/**
 * Flag records whose latest update doesn't count as a real change (minorUpdate: true).
 * With a change note, the provider's minor patterns decide. Without one, fall back to
 * spotting bulk republishes: a site that re-stamps every page at once leaves one date on
 * most entries, so a date shared by over 40% of a provider's records counts as a republish.
 */
export function classifyUpdates(records, patterns) {
  const counts = {};
  for (const r of records) counts[r.updated] = (counts[r.updated] || 0) + 1;
  for (const r of records) {
    if (r.change) { if (isMinorChange(r.change, patterns)) r.minorUpdate = true; }
    else if (counts[r.updated] > records.length * 0.4) r.minorUpdate = true;
  }
}

/**
 * Record each record's level per snapshot date in `history[providerId][title]` (mutated),
 * and set record.levelChange to the latest change. A different level on the same date is
 * ignored, so one bad response can't flap the history.
 */
export function trackHistory(history, providerId, asOf, records) {
  const book = (history[providerId] ??= {});
  for (const r of records) {
    const log = (book[r.title] ??= []);
    const last = log[log.length - 1];
    if (!last || (last.level !== r.level && asOf > last.date)) log.push({ date: asOf, level: r.level });
    if (log.length >= 2) {
      const [prev, cur] = log.slice(-2);
      r.levelChange = { date: cur.date, from: prev.level, to: cur.level };
    }
  }
}

// ---- providers and the whole site

/**
 * Build one provider's published data.
 * @param snapshot  { fetchedAt, source, entries: [{ name, level, updated, url?, change?, regional? }] }
 * @param config    config/providers/<id>.json
 * @param minorChange  the provider module's minor-change patterns
 * @param history   the dataset's history (mutated)
 */
export function buildProvider({ datasetId, config, snapshot, minorChange, index, history }) {
  const problems = [];
  const tag = `[${config.id}]`;
  const asOf = snapshot.fetchedAt.slice(0, 10);

  const records = [];
  for (const e of snapshot.entries) {
    const resolved = resolvePlaces(e.name, config, index);
    if (!resolved) { problems.push(`${tag} No place for "${e.name}": add it to aliases in config/providers/${config.id}.json`); continue; }
    for (const id of resolved.places) if (!index.byId.has(id)) problems.push(`${tag} "${e.name}" maps to unknown place "${id}"`);
    records.push({
      title: e.name,
      level: e.level,
      updated: e.updated,
      url: e.url,
      change: e.change,
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

  classifyUpdates(records, minorChange);
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
 *   datasets: [{ config, providers: [{ config, snapshot | null, minorChange }] }],
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
    for (const { config, snapshot, minorChange } of providers) {
      if (!snapshot) { problems.push(`[${config.id}] no snapshot yet: run node scripts/fetch.mjs ${config.id}`); continue; }
      const built = buildProvider({ datasetId: ds.id, config, snapshot, minorChange, index, history: dsHistory });
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
