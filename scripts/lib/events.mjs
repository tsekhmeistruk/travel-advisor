// Merging a risk source's new response into its stored events (pure). Every write is an
// upsert by the event's id (<source>:<source event id>), so fetching the same data twice
// changes nothing.
//
// - a new id is added, with firstSeen = this fetch
// - a known id is replaced by the new copy; a different native level (e.g. GDACS Green ->
//   Orange) is appended to its `revisions`, which the build turns into changes
// - an id missing from the response is kept: missing is not ended. The source's own
//   `current` flag says when it ended; a stored event that is still "current" but older than
//   the source's lookback window can't appear in a response any more, so it is closed.
// - an ended event is dropped (returned in `expired`, for the archive) retainEndedDays after
//   its end
//
// Two fields record what we observed, for the build (isActive() in lib/risk.mjs), which trusts
// them and not the source's own flag or dates:
// - updatedSeen: the fetch that first had the event, or last had it with another end date or
//   alert level: when we saw the source extend it. Another episode or flag alone doesn't count.
// - missingSince: the first fetch whose response didn't have it; gone again once it is back.
// Both change only when the event's state does, so the stored file still changes only then.

const DAY = 864e5;

/**
 * @param previous  stored events
 * @param incoming  parsed events of this response
 * @param at        this fetch's time (ISO)
 * @returns { events (sorted by id), expired, stats: { received, added, levelChanged, closed, expired } }
 */
export function mergeEvents(previous, incoming, { at, lookbackDays, retainEndedDays }) {
  const now = Date.parse(at);
  const byId = new Map(previous.map(e => [e.id, e]));
  const seen = new Set();
  const added = [];
  const levelChanged = [];
  const closed = [];

  for (const inc of incoming) {
    if (seen.has(inc.id)) continue;   // a source may list an event twice across pages
    seen.add(inc.id);
    const prev = byId.get(inc.id);
    if (!prev) {
      added.push(inc.id);
      byId.set(inc.id, { ...inc, firstSeen: at, updatedSeen: at, revisions: [{ at, value: inc.native.value }] });
      continue;
    }
    const revisions = [...(prev.revisions ?? [])];
    if (prev.native.value !== inc.native.value) {
      revisions.push({ at, value: inc.native.value });
      levelChanged.push(`${inc.id} ${prev.native.value} → ${inc.native.value}`);
    }
    const moved = prev.toDate !== inc.toDate || prev.native.value !== inc.native.value;
    const updatedSeen = moved ? at : prev.updatedSeen;
    byId.set(inc.id, { ...inc, firstSeen: prev.firstSeen, ...(updatedSeen && { updatedSeen }), revisions });
  }

  for (const e of byId.values()) {
    if (seen.has(e.id)) continue;
    const missing = { ...e, missingSince: e.missingSince ?? at };
    if (e.current && Date.parse(e.toDate) < now - lookbackDays * DAY) {
      missing.current = false;
      closed.push(e.id);
    }
    byId.set(e.id, missing);
  }

  const expired = [];
  const events = [];
  for (const e of byId.values()) {
    if (!e.current && Date.parse(e.toDate) < now - retainEndedDays * DAY) expired.push(e);
    else events.push(e);
  }
  events.sort((a, b) => a.id.localeCompare(b.id));
  return { events, expired, stats: { received: incoming.length, added, levelChanged, closed, expired: expired.length } };
}
