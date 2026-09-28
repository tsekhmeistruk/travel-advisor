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

/**
 * Everything the summary card shows for one place.
 * @returns {
 *   highest: { level, by },
 *   rows: [{ category, level, basis, changed, falling }]   basis: { travel: { agree, count } } | { events: [...] } | null;
 *                                                 falling: a lower level awaiting confirmation, or null
 *   trend: 'up' | 'down' | null                   the latest pulsing change in the last 24 hours
 *   history: the place's latest changes (up to `historySize`)
 *   link, linkSource: the first basis event's source page and source id, or null
 * }
 */
export function cardModel(placeId, { current, changes, events, now, windowDays, historySize = 3 }) {
  const eventsById = new Map(events.map(e => [e.id, e]));
  const own = changesFor(placeId, changes);
  const recent = filterChanges(own, { windowDays, now, pulseOnly: true });
  const rows = Object.keys(current.categories).map(category => {
    const signal = current.places[placeId]?.[category];
    const basis = category === 'travel'
      ? (signal ? { travel: { agree: signal.agree, count: Object.keys(signal.natives).length } } : null)
      : (signal?.basis?.length ? { events: signal.basis.map(id => eventsById.get(id)).filter(Boolean) } : null);
    const change = recent.find(c => c.category === category);
    return { category, level: levelOf(current, placeId, category), basis, changed: change ? direction(change) : null, falling: signal?.falling ?? null };
  });
  const last24 = filterChanges(own, { windowDays: 1, now, pulseOnly: true })[0];
  const linked = rows.flatMap(r => r.basis?.events ?? []).find(e => e.url);
  return { highest: highest(current, placeId), rows, trend: last24 ? direction(last24) : null, history: own.slice(0, historySize), link: linked?.url ?? null, linkSource: linked?.source ?? null };
}
