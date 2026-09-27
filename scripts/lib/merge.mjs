// Merging a provider's new fetch into its previous snapshot (pure). Used by providers whose
// source can't be trusted on a single response (U.S. API) or whose levels are read from
// prose (Netherlands): outdated copies are ignored, level changes need confirmation on a
// later day, and entries missing from a response are kept for a grace period.

/**
 * Merge this response into the previous snapshot. Mutates `byName`.
 * - an entry older than the saved one is a stale API copy: keep the saved one
 * - a different level is accepted only once confirmed: it must appear again in a fetch on a
 *   later day. Until then the saved entry is kept, with the candidate in `pending`. (The API
 *   once served Ethiopia as Level 1 "updated today" while the advisory was Level 3; a single
 *   response can't be trusted to change a level.) An unconfirmed candidate expires after
 *   graceDays.
 * - an advisory missing from the response is kept while unseen for <= graceDays
 */
export function mergeWithPrevious(byName, previous, today, graceDays) {
  const stale = [];
  const carried = [];
  const dropped = [];
  const unconfirmed = [];
  const confirmed = [];
  const daysSince = (date) => (Date.parse(today) - Date.parse(date)) / 864e5;

  for (const prev of previous) {
    const cur = byName.get(prev.name);
    // A pending candidate that hasn't been seen again in time is dropped.
    const pending = prev.pending && daysSince(prev.pending.firstSeen) <= graceDays ? prev.pending : undefined;
    const keep = (extra = {}) => {
      const { pending: _old, ...saved } = prev;
      byName.set(prev.name, { ...saved, lastSeen: today, ...(extra.pending && { pending: extra.pending }) });
    };

    if (!cur) {
      const lastSeen = prev.lastSeen ?? today;
      if (daysSince(lastSeen) > graceDays) { dropped.push(prev.name); continue; }
      const { pending: _old, ...saved } = prev;
      byName.set(prev.name, { ...saved, lastSeen, ...(pending && { pending }) });
      carried.push(prev.name);
      continue;
    }

    if (cur.updated < prev.updated) {
      keep({ pending });
      stale.push(`${prev.name} (got ${cur.updated} L${cur.level}, kept ${prev.updated} L${prev.level})`);
      continue;
    }

    if (cur.level === prev.level) continue;   // same level, same or newer date: accept as is

    // A different level, dated the same or later.
    if (pending?.level === cur.level && pending.firstSeen < today) {
      confirmed.push(`${prev.name} L${prev.level} → L${cur.level} (first seen ${pending.firstSeen})`);
      continue;   // confirmed on a later day: accept
    }
    const firstSeen = pending?.level === cur.level ? pending.firstSeen : today;
    keep({ pending: { level: cur.level, updated: cur.updated, url: cur.url, firstSeen } });
    unconfirmed.push(`${prev.name} L${prev.level} → L${cur.level} (dated ${cur.updated}; kept L${prev.level} until a later fetch confirms it)`);
  }
  const entries = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { entries, stale, carried, dropped, unconfirmed, confirmed };
}
