// Parsing and merging for U.S. State Department advisories (pure functions; the network
// side lives in ./index.mjs).
//
// The data API is inconsistent between calls: a response can leave out a few advisories,
// spell a name differently, or serve an outdated copy of an advisory. So each response is
// merged into the previous snapshot: names are matched to the ones already on file, an
// entry older than the saved one is ignored, a level change must be confirmed by a fetch on
// a later day, and an advisory missing from a response is kept until it has been unseen for
// `graceDays`.

import { decodeEntities, nameKey } from '../../lib/text.mjs';

// Entries whose title isn't "<Country> - Level N: ...", keyed by the API's country code.
export const NAME_BY_CODE = { MC: 'Macau', HK: 'Hong Kong', CH: 'China' };

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

// The merge with the previous snapshot is shared with other providers (scripts/lib/merge.mjs).
export { mergeWithPrevious } from '../../lib/merge.mjs';

