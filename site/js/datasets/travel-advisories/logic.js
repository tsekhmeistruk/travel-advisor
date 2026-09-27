// Pure logic for the travel-advisories dataset (no DOM), shared by the view and unit tests.

/**
 * Index a provider file by place.
 * @returns Map placeId -> { record, direct }
 *   direct: the record is this place's own advisory. Not direct: the place is one of several
 *   the record covers (e.g. Canada's "Israel and Palestine"), or falls under it via coveredBy.
 */
export function indexByPlace(records) {
  const byPlace = new Map();
  for (const record of records) {
    for (const id of record.covers ?? []) if (!byPlace.has(id)) byPlace.set(id, { record, direct: false });
    const shared = record.places.length > 1;
    for (const id of record.places) {
      // A place's own advisory wins over one that merely covers it.
      if (!shared || !byPlace.get(id)?.direct) byPlace.set(id, { record, direct: !shared });
    }
  }
  return byPlace;
}

/**
 * Recent = a level change within the window, or a real (not minor) update within it.
 * @param windowDays 0 turns highlighting off
 * @param ageDays    iso date -> days ago
 */
export function isRecent(record, windowDays, ageDays) {
  if (!record || windowDays === 0) return false;
  if (record.levelChange && ageDays(record.levelChange.date) <= windowDays) return true;
  return !record.minorUpdate && ageDays(record.updated) <= windowDays;
}

/** The date that makes a record recent: its level change if that's in the window, else its update. */
export function recentDate(record, windowDays, ageDays) {
  if (record.levelChange && ageDays(record.levelChange.date) <= windowDays) return record.levelChange.date;
  return record.updated;
}

/** Records to list in the change feed, newest first (then highest level). */
export function recentRecords(records, { windowDays, levels, ageDays }) {
  return records
    .filter(r => isRecent(r, windowDays, ageDays) && levels.includes(r.level))
    .sort((a, b) => recentDate(b, windowDays, ageDays).localeCompare(recentDate(a, windowDays, ageDays)) || b.level - a.level);
}

/** Pulse opacity for a recent record: fresher changes are more prominent. */
export function pulseOpacity(record, windowDays, ageDays) {
  return 0.45 + 0.55 * (1 - ageDays(recentDate(record, windowDays, ageDays)) / windowDays);
}

/** Why a place has no advisory: 'home' (the provider's own country), 'territory', or 'none'. */
export function noAdvisoryReason(placeId, data) {
  if (placeId === data.home) return 'home';
  if (data.territories.includes(placeId)) return 'territory';
  return 'none';
}

/** Title size class so long names shrink instead of wrapping (the details card has fixed slots). */
export function titleSize(name) {
  return name.length > 34 ? 'xlong' : name.length > 22 ? 'long' : '';
}
