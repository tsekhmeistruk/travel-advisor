// Parsing for Netherlands (Ministry of Foreign Affairs) travel advice (pure functions; the
// network side lives in ./index.mjs).
//
// The open-data API has no level field (its `classification` field "is no longer supported"),
// so the colour code is read from the Dutch summary ("In het kort"). The scale is
// groen (1) / geel (2) / oranje (3) / rood (4). Many advisories are regional ("orange for the
// south… for the rest, green"); the country's headline level is its baseline colour, like the
// U.S. and Canadian headline levels, with the regional flag set. Rules, in order:
//   1. single   - only one colour is mentioned
//   2. rest     - "(voor) de rest van … (geldt kleurcode) <colour>" names the baseline
//   3. country  - "(de kleurcode van het reisadvies) voor <country> is [voor het grootste deel] <colour>"
//                 followed by the end of the sentence or "(behalve …)": a whole-country statement
//   4. severest - otherwise the most severe colour mentioned (counted in stats; should stay rare)

import { decodeEntities, plainText } from '../../lib/text.mjs';

export const LEVEL_BY_COLOUR = { groen: 1, geel: 2, oranje: 3, rood: 4 };
const COLOUR = '(groen|geel|oranje|rood)';

/** The colour code of one advisory summary: { level, regional, rule } or null if none is mentioned. */
export function levelFromSummary(summaryHtml) {
  const text = plainText(decodeEntities(summaryHtml ?? ''));
  const mentioned = [...new Set((text.match(new RegExp(`\\b${COLOUR}\\b`, 'gi')) ?? []).map(c => c.toLowerCase()))];
  if (!mentioned.length) return null;
  const level = (colour) => LEVEL_BY_COLOUR[colour.toLowerCase()];
  if (mentioned.length === 1) return { level: level(mentioned[0]), regional: false, rule: 'single' };

  // "de rest van", not "voor de rest van": the source has typos ("Vor de rest van Marokko").
  const rest = text.match(new RegExp(`\\bde rest van\\b[^.]*?\\b${COLOUR}\\b`, 'i'));
  if (rest) return { level: level(rest[1]), regional: true, rule: 'rest' };

  const country = text.match(new RegExp(`\\bvoor (?!de rest)[^.]*? is (?:voor het grootste deel )?${COLOUR}(?=\\s*(?:\\.|\\(|$))`, 'i'));
  if (country) return { level: level(country[1]), regional: true, rule: 'country' };

  return { level: Math.max(...mentioned.map(level)), regional: true, rule: 'severest' };
}

/** The list endpoint answers with an array (JSON output); accept a wrapping object too. */
export function listDocuments(json) {
  const docs = Array.isArray(json) ? json : Object.values(json ?? {}).find(Array.isArray);
  if (!docs) throw new Error('Response has no list of advisories');
  return docs;
}

/**
 * Advisories from the list documents.
 * @returns { entries, rules: { single, rest, country, severest }, severest: [names], unreadable: [names] }
 */
export function parseAdvisories(docs) {
  const entries = [];
  const rules = { single: 0, rest: 0, country: 0, severest: 0 };
  const severest = [];
  const unreadable = [];
  for (const d of docs) {
    if (!d.location || !d.isocode || !d.lastmodified) throw new Error(`Advisory without location, code or date: ${JSON.stringify(d).slice(0, 120)}`);
    const colour = levelFromSummary(d.introduction);
    if (!colour) { unreadable.push(d.location); continue; }
    rules[colour.rule]++;
    if (colour.rule === 'severest') severest.push(d.location);
    const stamp = new Date(d.lastmodified).toISOString();
    entries.push({
      name: d.location,
      level: colour.level,
      regional: colour.regional || undefined,
      updated: stamp.slice(0, 10),
      stamp,
      url: d.canonical,
      iso: d.isocode,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, rules, severest, unreadable };
}
