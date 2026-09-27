// Parsing and merging for U.S. State Department advisories (pure functions; the network
// side lives in ./index.mjs).
//
// The data API is inconsistent between calls: a response can leave out a few advisories,
// spell a name differently, or serve an outdated copy of an advisory. So each response is
// merged into the previous snapshot: names are matched to the ones already on file, an
// entry older than the saved one is ignored, a level change must be confirmed by a fetch on
// a later day, and an advisory missing from a response is kept until it has been unseen for
// `graceDays`.

import { decodeEntities, nameKey, plainText } from '../../lib/text.mjs';

// Entries whose title isn't "<Country> - Level N: ...", keyed by the API's country code.
export const NAME_BY_CODE = { MC: 'Macau', HK: 'Hong Kong', CH: 'China' };

// How the State Department opens a change note in the RSS feed.
export const CHANGE_NOTE = /^(reissued|updated|there (were|was|are|is) no changes?|the advisory level|advisory level|level \d)/i;

/**
 * Turn raw API items into one entry per advisory name.
 * @param items   API response array ({ Title, Category, Updated, Published, Link })
 * @param previous entries from the previous snapshot (for canonical names)
 * @param today   'YYYY-MM-DD', stamped as lastSeen
 */
export function parseApiItems(items, previous, today) {
  const canonical = new Map(previous.map(e => [nameKey(e.name), e.name]));
  const byName = new Map();
  const warnings = [];
  let duplicates = 0;

  for (const item of items) {
    const m = decodeEntities(item.Title).match(/^(.+?)\s+-\s+Level\s+(\d)\b/);
    if (!m) throw new Error(`Unrecognised advisory title: ${item.Title}`);
    let name = m[1].replace(/\s+Travel Advisory$/i, '').trim();
    if (/ - See Summaries$|,.*&/.test(name)) name = NAME_BY_CODE[item.Category?.[0]] ?? name;
    name = canonical.get(nameKey(name)) ?? name;   // e.g. "Cote d Ivoire" -> "Côte d’Ivoire"
    const entry = {
      name,
      lastSeen: today,
      level: Number(m[2]),
      // API times are U.S. Eastern evenings; the UTC date matches the "Date Updated" on travel.state.gov.
      updated: new Date(item.Updated || item.Published).toISOString().slice(0, 10),
      url: item.Link,
    };
    // The API lists a few advisories twice; keep the most recent copy.
    const prev = byName.get(name);
    if (prev) {
      duplicates++;
      if (prev.level !== entry.level) warnings.push(`Duplicate "${name}" with different levels (${prev.level}, ${entry.level}); kept the newer.`);
    }
    if (!prev || entry.updated >= prev.updated) byName.set(name, entry);
  }
  return { byName, duplicates, warnings };
}

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

/** Change notes from the RSS feed, keyed by nameKey(): Map<key, { date, note }>. */
export function parseRssNotes(xml) {
  const tag = (s, t) => s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? '';
  const notes = new Map();
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const name = decodeEntities(tag(item, 'title')).replace(/\s+-\s+Level\s+\d[\s\S]*$/, '').replace(/\s+Travel Advisory$/i, '');
    const desc = decodeEntities(tag(item, 'description').replace(/<!\[CDATA\[|\]\]>/g, ''));
    const first = plainText(desc.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '');
    const note = first.replace(/^(Last Update|Reissued statement):\s*/i, '');
    if (!CHANGE_NOTE.test(note)) continue;    // first paragraph is the advisory text, not a change note
    notes.set(nameKey(name), { date: new Date(`${tag(item, 'pubDate')} UTC`).toISOString().slice(0, 10), note });
  }
  return notes;
}

/**
 * Attach RSS notes to entries. The feed lags for some countries, so a note is used only
 * when its date matches the entry's within a day (the API/RSS timezone offset). Mutates entries.
 * @returns number of entries that got a note
 */
export function attachNotes(entries, notes) {
  let matched = 0;
  for (const e of entries) {
    const n = notes.get(nameKey(e.name));
    if (n && Math.abs(Date.parse(n.date) - Date.parse(e.updated)) <= 864e5) { e.change = n.note; matched++; }
  }
  return matched;
}
