// Pure logic for the risk modes (no DOM), shared by the view and unit tests. It reads the
// published risk files (see "The risk layer" in docs/architecture.md):
//   current  { categories: { id: { sources, default } }, places: { placeId: { category: signal } } }
//   changes  newest first: { id, at, kind: level | event | advisory, category, placeId | placeIds, from, to, up }
//   events   { events: [{ id, level, native, type, name, placeIds, url }] }

const HOUR = 36e5;

// Only a level moving counts as a pulse, as on the travel map; new events are listed, not pulsed.
export const PULSE_KINDS = new Set(['level', 'advisory']);

/** A change's time: advisory changes are dated by UTC day, the others carry a time. */
export function changeTime(at) {
  return Date.parse(at.length === 10 ? `${at}T00:00:00Z` : at);
}

export function ageHours(at, now) {
  return Math.max(0, (now - changeTime(at)) / HOUR);
}

/**
 * News activity (a GDELT anomaly starting or ending) is published as a change, but it isn't
 * one: it never moves a level. The site lists level changes and alerts as changes, and news
 * activity only as it is now (the card's news line and the country view).
 */
export const isNews = (c) => c.kind === 'anomaly';

/** Whether data published at `asOf` is more than `hours` old (scheduled updates can be dropped). */
export function isStale(asOf, now, hours) {
  return ageHours(asOf, now) > hours;
}

/** The places a change is about: one for a level change, several for an event or advisory. */
export function changePlaces(c) {
  return c.placeIds ?? (c.placeId ? [c.placeId] : []);
}

/** 'up' for a rise or a new event, 'down' for a fall. */
export function direction(c) {
  return c.up === false ? 'down' : 'up';
}

/** A place's level in one category: its signal, else the category's default (null: no data). */
export function levelOf(current, placeId, category) {
  const meta = current.categories[category];
  if (!meta) return null;
  return current.places[placeId]?.[category]?.level ?? meta.default ?? null;
}

/** A place's level over some categories (a mode that shows several, e.g. disasters with wildfires): the highest, null if none has data. */
export function levelIn(current, placeId, categories) {
  const levels = [...categories].map(c => levelOf(current, placeId, c)).filter(l => l != null);
  return levels.length ? Math.max(...levels) : null;
}

/**
 * The highest level of any category with data, and the categories at that level (none for
 * Normal: nothing raised it). level is null when no category has data for the place.
 */
export function highest(current, placeId) {
  let level = null;
  let by = [];
  for (const c of Object.keys(current.categories)) {
    const l = levelOf(current, placeId, c);
    if (l == null) continue;
    if (level == null || l > level) { level = l; by = [c]; } else if (l === level) by.push(c);
  }
  return { level, by: level > 1 ? by : [] };
}

/**
 * Changes inside a window, optionally only rises or falls, only some categories, only the
 * kinds that pulse.
 * @param opts { windowDays, direction: 'all' | 'up' | 'down', categories: Set | null, pulseOnly, now }
 */
export function filterChanges(changes, { windowDays, direction: dir = 'all', categories = null, pulseOnly = false, now }) {
  return changes.filter(c => ageHours(c.at, now) <= windowDays * 24
    && (dir === 'all' || direction(c) === dir)
    && (!categories || categories.has(c.category))
    && (!pulseOnly || PULSE_KINDS.has(c.kind)));
}

/**
 * The countries list: every place with its level (in some categories, or the highest) and its
 * latest level change (a change that pulses), or null.
 * @returns [{ placeId, level, by, latest }]
 */
export function countryRows(current, changes, placeIds, { categories = null } = {}) {
  const latest = new Map();
  for (const c of changes) {   // newest first: the first one seen is a place's latest
    if (!PULSE_KINDS.has(c.kind) || (categories && !categories.has(c.category))) continue;
    for (const id of changePlaces(c)) if (!latest.has(id)) latest.set(id, c);
  }
  return [...placeIds].map((placeId) => {
    const h = categories ? { level: levelIn(current, placeId, categories), by: [] } : highest(current, placeId);
    return { placeId, level: h.level, by: h.by, latest: latest.get(placeId) ?? null };
  });
}

export const LIST_SORTS = ['level', 'recent', 'name'];

/**
 * A sorted copy of countryRows(): by level (highest first, no data last), by latest change
 * (newest first, none last) or by name. Ties go to the newer change, the higher level, then the name.
 */
export function sortRows(rows, sort, nameOf) {
  const desc = (x, y) => (x < y) - (x > y);
  const byLevel = (a, b) => desc(a.level ?? 0, b.level ?? 0);
  const byTime = (a, b) => desc(a.latest ? changeTime(a.latest.at) : 0, b.latest ? changeTime(b.latest.at) : 0);
  const byName = (a, b) => nameOf(a.placeId).localeCompare(nameOf(b.placeId));
  const order = { level: [byLevel, byTime, byName], recent: [byTime, byLevel, byName], name: [byName] }[sort] ?? [byName];
  return [...rows].sort((a, b) => {
    for (const f of order) { const d = f(a, b); if (d) return d; }
    return 0;
  });
}

/**
 * The feed's rows: a place's changes in one category are one row (one cyclone moving a level up
 * and down, and its alert with it, is one story), shown by its newest change with how many there
 * were; a change on no place is a row of its own. Newest first, as the input.
 * @returns [{ change (the newest), count }]
 */
export function groupFeed(changes) {
  const groups = new Map();
  for (const c of changes) {
    const place = changePlaces(c)[0];
    const key = place ? `${place}|${c.category}` : c.id;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { change: c, count: 1 });
  }
  return [...groups.values()];
}

/** Changes about one place, newest first (the input is newest first). */
export function changesFor(placeId, changes) {
  return changes.filter(c => changePlaces(c).includes(placeId));
}

/** Pulse opacity: fresher changes are more prominent. */
export function pulseOpacity(c, windowDays, now) {
  return 0.45 + 0.55 * (1 - Math.min(1, ageHours(c.at, now) / (windowDays * 24)));
}

/** How many places are at each level 1–4 (index 0 = level 1). */
export function countByLevel(placeIds, levelFn) {
  const counts = [0, 0, 0, 0];
  for (const id of placeIds) {
    const l = levelFn(id);
    if (l >= 1 && l <= 4) counts[l - 1]++;
  }
  return counts;
}

/** Rises and falls among the changes that pulse. */
export function countDirections(changes) {
  const pulsing = changes.filter(c => PULSE_KINDS.has(c.kind));
  return { up: pulsing.filter(c => direction(c) === 'up').length, down: pulsing.filter(c => direction(c) === 'down').length };
}

// Wildfires are a kind of disaster: on the card they share its row (the higher level, the alerts of both).
export const ROW_OF = { wildfire: 'disaster' };

/**
 * The card's rows: one per category, except a category folded into another's row (ROW_OF)
 * when that one has data too. Each row lists the categories it shows.
 * @returns [{ category, members: [category] }]
 */
export function cardRows(categories) {
  const ids = Object.keys(categories);
  return ids.filter(c => !(ROW_OF[c] && categories[ROW_OF[c]]))
    .map(category => ({ category, members: [category, ...ids.filter(c => ROW_OF[c] === category)] }));
}

/**
 * Everything the summary card shows for one place.
 * @returns {
 *   highest: { level, by },
 *   rows: [{ category, members, level, basis, changed, falling }]   basis: { travel: { agree, count } } | { events: [...] }
 *                                                 | { conflict: { deaths12 } } | null (cardRows(): wildfire is in the disaster row);
 *                                                 falling: a lower level awaiting confirmation, or null
 *   trend: 'up' | 'down' | null                   the latest pulsing change in the last 24 hours
 *   history: the place's latest changes (up to `historySize`)
 *   link, linkSource: the first basis event's source page and source id, or null
 * }
 */
export function cardModel(placeId, { current, changes, events, conflict = null, now, windowDays, historySize = 3 }) {
  const eventsById = new Map(events.map(e => [e.id, e]));
  const own = changesFor(placeId, changes);
  const recent = filterChanges(own, { windowDays, now, pulseOnly: true });
  const rows = cardRows(current.categories).map(({ category, members }) => {
    const signals = members.map(c => current.places[placeId]?.[c]).filter(Boolean);
    const levels = members.map(c => levelOf(current, placeId, c)).filter(l => l != null);
    const level = levels.length ? Math.max(...levels) : null;
    const signal = signals[0];
    let basis = null;
    if (category === 'travel') {
      basis = signal ? { travel: { agree: signal.agree, count: Object.keys(signal.natives).length, ...(signal.strictest && { strictest: signal.strictest }) } } : null;
    } else if (category === 'conflict') {
      basis = level != null && conflict ? { conflict: { deaths12: conflict.places?.[placeId]?.deaths12 ?? 0 } } : null;
    } else {
      const found = signals.flatMap(s => s.basis ?? []).map(id => eventsById.get(id)).filter(Boolean).sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
      basis = found.length ? { events: found } : null;
    }
    const change = recent.find(c => members.includes(c.category));
    return { category, members, level, basis, changed: change ? direction(change) : null, falling: signals.find(s => s.falling != null)?.falling ?? null };
  });
  const last24 = filterChanges(own, { windowDays: 1, now, pulseOnly: true })[0];
  const linked = rows.flatMap(r => r.basis?.events ?? []).find(e => e.url);
  return { highest: highest(current, placeId), rows, trend: last24 ? direction(last24) : null, history: own.filter(c => !isNews(c)).slice(0, historySize), link: linked?.url ?? null, linkSource: linked?.source ?? null };
}
