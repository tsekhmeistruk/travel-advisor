// Parsing for Germany's Federal Foreign Office (Auswärtiges Amt) travel warnings (pure; the
// network side lives in ./index.mjs).
//
// Source: the Foreign Office's open-data API. One list with every destination: ISO codes, the
// German name, when it was last changed, and four flags. Germany has no four-level scale, so
// its flags are mapped onto 1–4 (the site shows its own terms in English):
//   no flag                                                          1
//   situationPartWarning  travel to parts of the country advised against  2 (regional)
//   partialWarning        travel warning for parts (Teilreisewarnung)      3 (regional)
//   situationWarning      travel to the whole country advised against      3
//   warning               travel warning (Reisewarnung)                    4
// The most severe flag sets the level.

export const LEVEL_BY_FLAG = { situationPartWarning: 2, partialWarning: 3, situationWarning: 3, warning: 4 };
const REGIONAL = new Set(['situationPartWarning', 'partialWarning']);

/** Destinations of the list: { name, level, regional, updated, iso }, sorted by name. */
export function parseWarnings(json) {
  const r = json?.response;
  if (!r || !Array.isArray(r.contentList)) throw new Error('Foreign Office response has no list of destinations');
  const entries = r.contentList.map(id => {
    const d = r[id];
    if (!d?.countryName || !d.iso3CountryCode || !d.lastModified) throw new Error(`Destination ${id} without name, code or date: ${JSON.stringify(d).slice(0, 120)}`);
    const flags = Object.keys(LEVEL_BY_FLAG).filter(f => d[f] === true);
    const level = Math.max(1, ...flags.map(f => LEVEL_BY_FLAG[f]));
    return {
      name: d.countryName,
      level,
      regional: (level < 4 && flags.some(f => REGIONAL.has(f) && LEVEL_BY_FLAG[f] === level)) || undefined,
      updated: new Date(d.lastModified * 1000).toISOString().slice(0, 10),
      iso: d.iso3CountryCode,
    };
  });
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
