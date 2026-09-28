// The risk layer of the build (pure): turns source facts into risk signals, records confirmed
// changes, and produces the published risk files. No file access here; scripts/build.mjs
// gathers the inputs and writes the outputs.
//
// Three things are kept apart, and published apart:
//   source facts   what a source said: an advisory's level, a GDACS event's alert colour
//   signals        our level (1–4) per place and category, with the facts that set it (basis)
//   changes        a confirmed move of a signal, a new major event, an advisory level change
//
// Published (site/data/risk/):
//   current.json   every place's signals; event categories list only places above Normal
//   changes.json   changes of the last CHANGE_WINDOW_DAYS days, newest first
//   events.json    active events (for markers and "why")
//   health.json    each provider's and source's last success and status

import { levelChangesOf } from './build.mjs';
import { nameKey } from './text.mjs';

const DAY = 864e5;
export const CHANGE_WINDOW_DAYS = 90;
export const NORMAL = 1;
// Advisory providers are fetched once a day; their data is stale after a week (the site's
// header says so too).
export const ADVISORY_STALE_HOURS = 7 * 24;
// The level from which a new event, or an event's alert change, is a change worth listing.
export const MAJOR_LEVEL = 3;

// ---- health

/**
 * Status of one provider or source:
 *   healthy   last success within 1.5 × its interval
 *   delayed   older than that, or the latest attempt failed, but within the stale limit
 *   error     never succeeded, or the last success is past the stale limit
 */
export function healthStatus(state, { intervalMinutes, staleAfterHours }, now) {
  if (!state?.lastSuccess) return 'error';
  const ageMin = (now - Date.parse(state.lastSuccess)) / 60000;
  if (ageMin > staleAfterHours * 60) return 'error';
  if (state.consecutiveFailures > 0 || ageMin > intervalMinutes * 1.5) return 'delayed';
  return 'healthy';
}

function intervalMinutes(rule) {
  return rule?.everyMinutes ?? 24 * 60;
}

// ---- travel signals (from the built advisory files)

/**
 * The travel category per place: the highest level among the governments that cover it,
 * with each government's own level (its native value) and how many agree on the highest.
 * A place's own advisory wins over one that merely covers it (as on the map).
 * @param files  { providerId: published provider data }
 */
export function travelSignals(files) {
  const byPlace = new Map();
  for (const [provider, data] of Object.entries(files)) {
    const own = new Map();
    for (const r of data.records) {
      for (const id of r.covers ?? []) if (!own.has(id)) own.set(id, { level: r.level, direct: false });
      const direct = r.places.length === 1;
      for (const id of r.places) if (direct || !own.get(id)?.direct) own.set(id, { level: r.level, direct });
    }
    for (const [id, { level }] of own) (byPlace.get(id) ?? byPlace.set(id, {}).get(id))[provider] = level;
  }
  const signals = new Map();
  for (const [id, natives] of byPlace) {
    const level = Math.max(...Object.values(natives));
    signals.set(id, { level, natives, agree: Object.values(natives).filter(l => l === level).length });
  }
  return signals;
}

// ---- event signals

/** Our level for an event: the source's scheme mapped through its config, capped per type. */
export function eventLevel(event, config) {
  const level = config.levels[event.native.value];
  if (level == null) return null;
  return Math.min(level, config.types[event.code]?.maxLevel ?? 4);
}

/** An event counts while the source calls it current, then for its type's tail after its end. */
export function isActive(event, config, at) {
  if (event.current) return true;
  const tail = config.types[event.code]?.tailDays ?? 0;
  return Date.parse(event.toDate) + tail * DAY >= Date.parse(at);
}

/**
 * Places of an event: by ISO alpha-3 code (the source config's `codes` first, for codes that
 * aren't one place, e.g. PSE), else by the country names it gives (its `aliases` first, e.g.
 * WHO's official names). A name that isn't a place but contains " and " is tried in parts
 * ("Mauritania and Senegal"), so "Trinidad and Tobago" stays one. [] when it is offshore.
 */
export function eventPlaces(event, config, index) {
  const ids = new Set();
  const unknownCodes = [];
  for (const code of event.iso3 ?? []) {
    const hit = config.codes?.[code] ?? index.byCode.get(code);
    if (hit) [].concat(hit).forEach(id => ids.add(id));
    else unknownCodes.push(code);
  }
  const byName = (name) => config.aliases?.[name] ?? index.byKey.get(nameKey(name));
  if (!ids.size && event.country) {
    for (const name of event.country.split(/,\s*/)) {
      const hit = byName(name) ?? (/\sand\s/.test(name) ? name.split(/\s+and\s+/).map(byName).filter(Boolean).flat() : null);
      if (hit) [].concat(hit).forEach(id => ids.add(id));
    }
  }
  return { placeIds: [...ids].sort(), unknownCodes };
}

/**
 * Levels per category and place from one source's events.
 * @returns { byCategory: Map category -> Map placeId -> { level, basis }, events: published events, warnings }
 */
export function eventSignals(sourceId, data, config, index) {
  const byCategory = new Map(Object.values(config.types).map(t => [t.category, new Map()]));
  const events = [];
  const warnings = [];
  const at = data.fetchedAt;
  for (const e of data.events) {
    const type = config.types[e.code];
    if (!type) { warnings.push(`[${sourceId}] ${e.id}: unknown event type "${e.code}"`); continue; }
    const level = eventLevel(e, config);
    if (level == null) warnings.push(`[${sourceId}] ${e.id}: unknown ${config.scheme} value "${e.native.value}"`);
    if (!isActive(e, config, at)) continue;
    const { placeIds, unknownCodes } = eventPlaces(e, config, index);
    if (unknownCodes.length) warnings.push(`[${sourceId}] ${e.id}: unknown country codes ${unknownCodes.join(', ')}`);
    events.push({
      id: e.id, source: sourceId, type: type.type, category: type.category, level, native: e.native,
      name: e.name, country: e.country, severity: e.severity, placeIds, point: e.point,
      startedAt: e.startedAt, toDate: e.toDate, current: e.current, url: e.url,
    });
    if (level == null) continue;
    const places = byCategory.get(type.category);
    for (const id of placeIds) {
      const cur = places.get(id);
      if (!cur || level > cur.level) places.set(id, { level, basis: [e.id] });
      else if (level === cur.level) cur.basis = [...cur.basis, e.id].sort();
    }
  }
  return { byCategory, events, warnings };
}

// ---- confirmed signal state and level changes

/**
 * Update one category's confirmed state with this run's computed levels, and list the level
 * changes. A rise is recorded at once. A fall only when the lower level still holds on a
 * fetch at least `confirmFallMinutes` after it was first seen (sources rescore events in the
 * first hours, and a level must not flap). The first run of a category sets its baseline
 * without changes. Running again on the same data changes nothing.
 *
 * @param prev      stored state of the category ({ trackedSince, at, places }) or undefined
 * @param computed  Map placeId -> { level, basis }; absent places are Normal
 * @returns { state, changes }
 */
export function updateSignals(prev, computed, { category, at, confirmFallMinutes, sources }) {
  const places = {};
  const changes = [];
  const change = (placeId, from, to, basis) => changes.push({
    id: `${placeId}:${category}:${at}`, at, kind: 'level', category, placeId, from, to, up: to > from, basis, sources,
  });
  const ids = [...new Set([...Object.keys(prev?.places ?? {}), ...computed.keys()])].sort();

  for (const id of ids) {
    const old = prev?.places?.[id];
    const was = old?.level ?? NORMAL;
    const { level: next = NORMAL, basis = [] } = computed.get(id) ?? {};
    if (!prev) {
      if (next > NORMAL) places[id] = { level: next, basis };
    } else if (next > was) {
      change(id, was, next, basis);
      places[id] = { level: next, since: at, from: was, basis };
    } else if (next < was) {
      const pending = old.pending?.level === next ? old.pending : { level: next, firstSeen: at };
      if (Date.parse(at) - Date.parse(pending.firstSeen) >= confirmFallMinutes * 60000) {
        change(id, was, next, basis);
        if (next > NORMAL) places[id] = { level: next, since: at, from: was, basis };
      } else {
        places[id] = { ...old, pending };
      }
    } else if (next > NORMAL) {
      places[id] = { level: next, since: old?.since, from: old?.from, basis };
    }
  }
  return { state: { trackedSince: prev?.trackedSince ?? at, at, places }, changes };
}

// ---- event changes

/**
 * Changes from a source's events: a new event at MAJOR_LEVEL or above (not those of the
 * source's first fetch, which set the baseline), and an alert change where either side is.
 */
export function eventChanges(sourceId, data, config, index) {
  const changes = [];
  for (const e of data.events) {
    const type = config.types[e.code];
    if (!type) continue;
    const levelAt = (value) => eventLevel({ ...e, native: { ...e.native, value } }, config);
    const base = { kind: 'event', category: type.category, source: sourceId, eventId: e.id, type: type.type, placeIds: eventPlaces(e, config, index).placeIds };
    const revs = e.revisions ?? [];
    const first = revs[0] ? levelAt(revs[0].value) : null;
    if (first >= MAJOR_LEVEL && e.firstSeen !== data.firstFetchedAt) {
      changes.push({ id: `${e.id}:${e.firstSeen}`, at: e.firstSeen, ...base, to: first, native: revs[0].value, new: true });
    }
    for (let i = 1; i < revs.length; i++) {
      const from = levelAt(revs[i - 1].value);
      const to = levelAt(revs[i].value);
      if (from !== to && Math.max(from ?? 0, to ?? 0) >= MAJOR_LEVEL) {
        changes.push({ id: `${e.id}:${revs[i].at}`, at: revs[i].at, ...base, from, to, up: to > from, native: revs[i].value });
      }
    }
  }
  return changes;
}

/** Advisory level changes from the level history, on each record's own places. */
export function advisoryChanges(history, files) {
  const changes = [];
  for (const [provider, data] of Object.entries(files)) {
    const byTitle = new Map(data.records.map(r => [r.title, r]));
    for (const [title, log] of Object.entries(history[provider] ?? {})) {
      const record = byTitle.get(title);
      if (!record) continue;   // an advisory that no longer exists
      for (const c of levelChangesOf(log)) {
        changes.push({
          id: `advisory:${provider}:${title}:${c.date}`, at: c.date, kind: 'advisory', category: 'travel', source: provider,
          title, placeIds: record.places, from: c.from, to: c.to, up: c.up, ...(c.seeded && { seeded: true }),
        });
      }
    }
  }
  return changes;
}

// ---- the whole risk layer

/**
 * @param input {
 *   index        placeIndex() of the registry
 *   categories   config/categories.json
 *   schedule     config/schedule.json
 *   advisories   { files: { providerId: published data }, history, flags: { providerId: flag code } }
 *   sources      { id: { config, data: stored events | null } }
 *   state        data/signals/current.json (or null)
 *   log          stored change log entries (this year and last)
 *   sourcesState data/sources-state.json
 * }
 * @returns { files: { relPath: data }, state, newChanges, warnings }
 */
export function buildRisk({ index, categories, schedule, advisories, sources, state, log, sourcesState }) {
  const warnings = [];
  const fetchTimes = [
    ...Object.values(sourcesState).map(s => s.lastAttempt),
    ...Object.values(sources).map(s => s.data?.fetchedAt),
    ...Object.values(advisories.files).map(d => d.asOf),
  ].filter(Boolean).sort();
  // The build's "now" comes from its inputs, so building the same data twice gives the same files.
  const asOf = fetchTimes.at(-1) ?? null;
  const now = asOf ? Date.parse(asOf) : 0;

  const health = {};
  for (const id of Object.keys(schedule).sort()) {
    const s = sourcesState[id] ?? {};
    const limits = { intervalMinutes: intervalMinutes(schedule[id]), staleAfterHours: sources[id]?.config.staleAfterHours ?? ADVISORY_STALE_HOURS };
    health[id] = {
      status: healthStatus(s, limits, now),
      lastSuccess: s.lastSuccess, lastAttempt: s.lastAttempt, consecutiveFailures: s.consecutiveFailures, records: s.records, error: s.error,
    };
  }

  // Signals per category.
  const catIds = categories.categories.map(c => c.id);
  const places = {};
  const put = (id, cat, signal) => { (places[id] ??= {})[cat] = signal; };
  for (const [id, s] of travelSignals(advisories.files)) put(id, 'travel', s);
  const catMeta = { travel: { sources: Object.keys(advisories.files), default: null } };

  const newState = { categories: { ...(state?.categories ?? {}) } };
  const derived = [...advisoryChanges(advisories.history, advisories.files)];
  const events = [];
  for (const [sourceId, { config, data }] of Object.entries(sources)) {
    const cats = [...new Set(Object.values(config.types).map(t => t.category))];
    for (const c of cats) if (!catIds.includes(c)) warnings.push(`[${sourceId}] category "${c}" is not in config/categories.json`);
    const available = data && health[sourceId]?.status !== 'error';
    for (const c of cats) catMeta[c] = { sources: [sourceId], default: available ? NORMAL : null, status: health[sourceId]?.status ?? 'error', at: data?.fetchedAt };
    if (!available) continue;   // keep the last state: a source that is down doesn't make places "Normal"

    const signals = eventSignals(sourceId, data, config, index);
    warnings.push(...signals.warnings);
    events.push(...signals.events);
    for (const e of signals.events.filter(x => !x.placeIds.length)) warnings.push(`[${sourceId}] ${e.id} (${e.name}) is on no place; shown as a marker only`);
    for (const c of cats) {
      const { state: catState, changes } = updateSignals(state?.categories?.[c], signals.byCategory.get(c), {
        category: c, at: data.fetchedAt, confirmFallMinutes: config.confirmFallMinutes, sources: [sourceId],
      });
      newState.categories[c] = catState;
      derived.push(...changes);
    }
    derived.push(...eventChanges(sourceId, data, config, index));
  }

  for (const [c, cat] of Object.entries(newState.categories)) {
    if (catMeta[c]?.default == null) continue;
    for (const [id, s] of Object.entries(cat.places)) {
      put(id, c, { level: s.level, since: s.since, from: s.from, basis: s.basis });
    }
  }

  // The change log keeps risk changes; advisory changes are always derived from the history.
  const known = new Set(log.map(c => c.id));
  const newChanges = derived.filter(c => c.kind !== 'advisory' && !known.has(c.id)).sort(byTime);
  const cutoff = asOf ? new Date(now - CHANGE_WINDOW_DAYS * DAY).toISOString().slice(0, 10) : '';
  const recent = [...log, ...newChanges, ...derived.filter(c => c.kind === 'advisory')]
    .filter(c => c.at >= cutoff).sort(byTime).reverse();

  const sortedPlaces = Object.fromEntries(Object.keys(places).sort().map(id => [id, places[id]]));
  const categoriesOut = Object.fromEntries(catIds.filter(c => catMeta[c]).map(c => [c, catMeta[c]]));
  // Who the levels come from, for attribution: risk sources first, then the governments.
  const sourcesOut = {
    ...Object.fromEntries(Object.entries(sources).map(([id, { config }]) => [id, { url: config.links?.home, terms: config.links?.terms }])),
    ...Object.fromEntries(Object.entries(advisories.files).map(([id, d]) => [id, { url: d.links?.list, flag: advisories.flags?.[id] }])),
  };
  const files = {
    'risk/current.json': { asOf, scale: categories.scale, categories: categoriesOut, sources: sourcesOut, places: sortedPlaces },
    'risk/changes.json': { asOf, windowDays: CHANGE_WINDOW_DAYS, changes: recent },
    'risk/events.json': { asOf, events: events.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id)) },
    'risk/health.json': { asOf, sources: health },
    ...placeFiles({ placeIds: [...index.byId.keys()].sort(), advisoryFiles: advisories.files, events, changes: [...log, ...newChanges, ...derived.filter(c => c.kind === 'advisory')], asOf }),
  };
  return { files, state: newState, newChanges, warnings };
}

function byTime(a, b) { return a.at.localeCompare(b.at) || a.id.localeCompare(b.id); }

export const PLACE_HISTORY_DAYS = 365;

/**
 * One file per place for its country view: each government's advisory (level, title, date,
 * link), the ids of the active events on it, and its changes of the last PLACE_HISTORY_DAYS
 * days, newest first. No as-of time inside, so a file changes only when its content does.
 * @param changes  every change known (log, new, advisory), any order
 */
export function placeFiles({ placeIds, advisoryFiles, events, changes, asOf }) {
  const cutoff = asOf ? new Date(Date.parse(asOf) - PLACE_HISTORY_DAYS * DAY).toISOString().slice(0, 10) : '';
  const advisories = new Map();
  for (const [provider, data] of Object.entries(advisoryFiles)) {
    for (const r of data.records) {
      for (const id of [...r.places, ...(r.covers ?? [])]) {
        const own = r.places.length === 1 && r.places[0] === id;
        const prev = advisories.get(id)?.[provider];
        if (prev?.own && !own) continue;   // its own advisory wins over one that covers it
        (advisories.get(id) ?? advisories.set(id, {}).get(id))[provider] = { level: r.level, title: r.title, updated: r.updated, url: r.url, own };
      }
    }
  }
  const byPlace = new Map(placeIds.map(id => [id, []]));
  for (const c of [...changes].sort(byTime).reverse()) {
    if (c.at < cutoff) continue;
    for (const id of c.placeIds ?? [c.placeId]) byPlace.get(id)?.push(c);
  }
  const files = {};
  for (const id of placeIds) {
    files[`risk/places/${id}.json`] = {
      placeId: id,
      advisories: advisories.get(id) ?? {},
      events: events.filter(e => e.placeIds.includes(id)).map(e => e.id),
      changes: byPlace.get(id),
    };
  }
  return files;
}
