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

/** A record's latest level change ({ date, from, to, up }), or null. */
export function latestChange(record) {
  return record?.levelChanges?.[0] ?? null;
}

/**
 * Recent = the level went up or down within the window. Nothing else counts: text edits and
 * reissues at the same level are not tracked.
 * @param windowDays 0 turns highlighting off
 * @param ageDays    iso date -> days ago
 */
export function isRecent(record, windowDays, ageDays) {
  const change = latestChange(record);
  return windowDays > 0 && !!change && ageDays(change.date) <= windowDays;
}

/** Records to list in the change feed, newest change first (then highest level). */
export function recentRecords(records, { windowDays, levels, ageDays }) {
  return records
    .filter(r => isRecent(r, windowDays, ageDays) && levels.includes(r.level))
    .sort((a, b) => latestChange(b).date.localeCompare(latestChange(a).date) || b.level - a.level);
}

/** Pulse opacity for a recent record: fresher changes are more prominent. */
export function pulseOpacity(record, windowDays, ageDays) {
  return 0.45 + 0.55 * (1 - ageDays(latestChange(record).date) / windowDays);
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
