// Parsing for Government of Canada advisories (pure functions; the network side lives in
// ./index.mjs).
//
// The advisory table gives each destination's level and "last updated" timestamp. What
// changed ("Latest updates") is only on each destination's own page, so pages are read
// only when their timestamp differs from the previous snapshot.

import { decodeEntities } from '../../lib/text.mjs';

export const SITE = 'https://travel.gc.ca';

// CSS class on each row's risk-level cell -> level 1..4.
export const LEVEL_BY_CLASS = {
  'normal-precautions': 1,
  'increased-caution': 2,
  'reconsider-travel': 3,
  'do-not-travel': 4,
};

// One <tr> per destination: hidden slug, link + name, risk-level div, timestamp.
const ROW = /<tr>\s*<!-- 1\.[\s\S]*?<a href='([^']*)'>([^<]*)<\/a><\/td>[\s\S]*?<div class='([^']*)'>[\s\S]*?-->([^<]*)<!-- END[\s\S]*?<td[^>]*>([^<]*)<\/td>/g;

/** Destinations from the advisory table page. */
export function parseTable(html) {
  const entries = [];
  for (const [, href, name, cls, text, stamp] of html.matchAll(ROW)) {
    const level = LEVEL_BY_CLASS[cls.trim()];
    if (!level) throw new Error(`Unknown risk class "${cls}" for ${name}`);
    entries.push({
      name: decodeEntities(name.trim()),
      level,
      regional: /regional advisories/i.test(text),
      updated: stamp.trim().slice(0, 10),
      stamp: stamp.trim(),
      url: SITE + href,
    });
  }
  return entries;
}

/** The "Latest updates" line from a destination page, or null if absent. */
export function parseLatestUpdate(pageHtml) {
  const m = pageHtml.match(/id="lastUpdateTextLbl">([^<]*)</);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : null;
}

/**
 * Reuse notes for destinations whose timestamp is unchanged since the previous snapshot
 * (mutates entries); return the ones whose page must be read.
 */
export function planPageReads(entries, previousEntries) {
  const previous = new Map(previousEntries.map(e => [e.name, e]));
  const toRead = [];
  for (const e of entries) {
    const prev = previous.get(e.name);
    if (prev && prev.stamp === e.stamp && prev.change !== undefined) e.change = prev.change;
    else toRead.push(e);
  }
  return toRead;
}
