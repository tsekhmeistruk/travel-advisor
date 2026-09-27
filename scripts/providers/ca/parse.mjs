// Parsing for Government of Canada advisories (pure functions; the network side lives in
// ./index.mjs).
//
// Two sources:
//  - the official open-data JSON feed (data.international.gc.ca): every destination in one
//    file, with its ISO code, level, regional flag, "what changed" and an official change
//    type. It is rebuilt about once a day, so it can lag the website by up to a day.
//  - the advisory table on travel.gc.ca: live, but has no "what changed", which is only on
//    each destination's own page.
// The feed is the base; the table overrides destinations updated since the feed was built,
// and only those pages are read for their note.

import { decodeEntities } from '../../lib/text.mjs';

export const SITE = 'https://travel.gc.ca';

// ---- JSON feed

/**
 * Destinations from the JSON feed (English fields only).
 * @returns { generated: 'YYYY-MM-DD HH:MM:SS' (Eastern) | null, entries: [...] }
 */
export function parseFeed(json) {
  const data = json?.data;
  if (!data || typeof data !== 'object') throw new Error('Feed has no "data" object');
  const entries = Object.values(data).map((d) => {
    const level = Number(d['advisory-state']) + 1;
    if (!(level >= 1 && level <= 4)) throw new Error(`Unknown advisory-state "${d['advisory-state']}" for ${d.eng?.name}`);
    const stamp = d['date-published']?.date;
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp ?? '')) throw new Error(`Bad date-published for ${d.eng?.name}`);
    if (!d.eng?.name || !d.eng['url-slug']) throw new Error(`Feed entry without an English name or slug (${d['country-iso']})`);
    return {
      name: d.eng.name,
      level,
      regional: d['has-regional-advisory'] === 1,
      updated: stamp.slice(0, 10),
      stamp,
      url: `${SITE}/destinations/${d.eng['url-slug']}`,
      change: d.eng['recent-updates'] || undefined,
      changeType: d['recent-updates-type'] || undefined,
      iso: d['country-iso'],
    };
  });
  return { generated: json.metadata?.generated?.date ?? null, entries };
}

// ---- HTML table

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

// ---- combining

/**
 * Merge feed and table entries (matched by destination URL). The feed is the base; where
 * the table has a newer timestamp, the table's level, regional flag and date win and the
 * feed's note no longer applies (the page must be read). Destinations only in one source
 * are kept. Either list may be empty when its source failed.
 * @returns { entries, newerInTable: [names] }
 */
export function combineSources(feedEntries, tableEntries) {
  const table = new Map(tableEntries.map(e => [e.url, e]));
  const newerInTable = [];
  const entries = feedEntries.map((f) => {
    const t = table.get(f.url);
    table.delete(f.url);
    if (!t || t.stamp <= f.stamp) return f;
    newerInTable.push(t.name);
    return { ...t, iso: f.iso };   // newer on the website: note and change type unknown until its page is read
  });
  for (const t of table.values()) { entries.push(t); newerInTable.push(t.name); }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, newerInTable };
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
    if (prev && prev.stamp === e.stamp && prev.change !== undefined) {
      e.change = prev.change;
      if (prev.changeType) e.changeType = prev.changeType;
    } else {
      toRead.push(e);
    }
  }
  return toRead;
}
