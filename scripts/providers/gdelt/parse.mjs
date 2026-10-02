// Parsing for GDELT daily event files (pure; the network side lives in ./index.mjs).
//
// GDELT codes news reports into events, machine-read and unverified. A daily file
// (events/<yyyymmdd>.export.CSV.zip) holds the events added that day, one tab-separated
// line each, 58 columns (GDELT 1.0 event format). These matter here:
//   28  EventRootCode           CAMEO root: 14 protest, 15 force posture, 18 assault, 19 fight, 20 mass violence
//   26  EventCode               the full CAMEO code (138…: threaten with military force)
//    7, 17  Actor1CountryCode, Actor2CountryCode   who acts on whom: CAMEO country codes (mostly ISO alpha-3)
//   51  ActionGeo_CountryCode   where it happened, as a FIPS 10-4 code (not ISO)
//    0  GLOBALEVENTID           to count each event once
// Counts are per place and series (config/sources/gdelt.json `series`), with FIPS codes
// mapped to places by `fips`. Military events between two countries' actors (`pairs`: force
// posture, fighting, threats of force) are counted per pair of country codes, as given (the build
// maps them to places). These are counts of news reports, not of verified incidents: the build
// uses them only to spot unusual activity, never to set a level.

const COLUMNS = 58;
const COL = { id: 0, actor1: 7, actor2: 17, code: 26, root: 28, country: 51 };
const COUNTRY = /^[A-Z]{3}$/;

/**
 * @param csv     the daily file's text
 * @param config  config/sources/gdelt.json
 * @returns { counts: { placeId: { series: n } }, pairs: { "RUS|UKR": { military: n } }, events, matched, unmapped: { fips: n } }
 *   pairs: only with `config.pairs`; the two codes sorted, both three letters and different
 */
export function countEvents(csv, config) {
  const seriesByRoot = new Map();
  for (const [name, s] of Object.entries(config.series)) for (const code of s.rootCodes) seriesByRoot.set(code, name);
  const pairRoots = new Set(config.pairs?.rootCodes ?? []);
  const pairCodes = config.pairs?.eventCodes ?? [];
  const military = (f) => !!config.pairs && (pairRoots.has(f[COL.root]) || pairCodes.some(p => f[COL.code].startsWith(p)));
  const counts = {};
  const pairs = {};
  const unmapped = {};
  const seen = new Set();
  let events = 0;
  let matched = 0;
  let malformed = 0;
  for (const line of csv.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (f.length !== COLUMNS) { malformed++; continue; }
    events++;
    const series = seriesByRoot.get(f[COL.root]);
    const pair = military(f);
    if ((!series && !pair) || seen.has(f[COL.id])) continue;
    seen.add(f[COL.id]);
    const [a, b] = [f[COL.actor1], f[COL.actor2]];
    if (pair && a !== b && COUNTRY.test(a) && COUNTRY.test(b)) {
      const key = [a, b].sort().join('|');
      (pairs[key] ??= { military: 0 }).military++;
    }
    if (!series) continue;
    const fips = f[COL.country];
    if (!fips) continue;   // no location
    const place = config.fips[fips];
    if (!place) { unmapped[fips] = (unmapped[fips] ?? 0) + 1; continue; }
    matched++;
    const c = (counts[place] ??= {});
    c[series] = (c[series] ?? 0) + 1;
  }
  // A file of another format would have (almost) no line of 58 columns.
  if (events === 0 || malformed > events) throw new Error(`GDELT file not in the expected format (${events} events, ${malformed} other lines)`);
  return { counts, ...(config.pairs && { pairs }), events, matched, unmapped };
}

/** "20260927" for a day "2026-09-27". */
export function fileDay(day) {
  return day.replaceAll('-', '');
}
