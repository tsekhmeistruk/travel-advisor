// Parsing for GDELT daily event files (pure; the network side lives in ./index.mjs).
//
// GDELT codes news reports into events, machine-read and unverified. A daily file
// (events/<yyyymmdd>.export.CSV.zip) holds the events added that day, one tab-separated
// line each, 58 columns (GDELT 1.0 event format). Only three matter here:
//   28  EventRootCode           CAMEO root: 14 protest, 18 assault, 19 fight, 20 mass violence
//   51  ActionGeo_CountryCode   where it happened, as a FIPS 10-4 code (not ISO)
//    0  GLOBALEVENTID           to count each event once
// Counts are per place and series (config/sources/gdelt.json `series`), with FIPS codes
// mapped to places by `fips`. These are counts of news reports, not of verified incidents:
// the build uses them only to spot unusual activity, never to set a level.

const COLUMNS = 58;
const COL = { id: 0, root: 28, country: 51 };

/**
 * @param csv     the daily file's text
 * @param config  config/sources/gdelt.json
 * @returns { counts: { placeId: { series: n } }, events, matched, unmapped: { fips: n } }
 */
export function countEvents(csv, config) {
  const seriesByRoot = new Map();
  for (const [name, s] of Object.entries(config.series)) for (const code of s.rootCodes) seriesByRoot.set(code, name);
  const counts = {};
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
    if (!series || seen.has(f[COL.id])) continue;
    seen.add(f[COL.id]);
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
  return { counts, events, matched, unmapped };
}

/** "20260927" for a day "2026-09-27". */
export function fileDay(day) {
  return day.replaceAll('-', '');
}
