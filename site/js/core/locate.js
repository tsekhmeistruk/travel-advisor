// Which country the visitor is probably in, for where the mascot lives. No request is made and
// no address is looked up: the guess is from what the browser already says, its time zone
// ("Europe/Kyiv" is Ukraine's), then the region of its languages ("en-CA"). Pure: the caller
// gives the time zones of a country.

// Names a browser may still give for a zone, and the names they have now.
const RENAMED = {
  'Europe/Kiev': 'Europe/Kyiv', 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon', 'America/Buenos_Aires': 'America/Argentina/Buenos_Aires', 'Atlantic/Faeroe': 'Atlantic/Faroe',
  'America/Godthab': 'America/Nuuk', 'Pacific/Truk': 'Pacific/Chuuk', 'Pacific/Ponape': 'Pacific/Pohnpei',
};
const zone = (name) => (name ? RENAMED[name] ?? name : null);

/**
 * @param opts.timeZone   the browser's time zone (IANA name)
 * @param opts.languages  the browser's languages, the preferred one first
 * @param opts.places     the place registry ([{ id, iso2 }])
 * @param opts.zonesOf(iso2)  the time zones of a country ([] if unknown)
 * @returns a place id, or null when nothing tells
 */
export function guessPlace({ timeZone, languages = [], places, zonesOf }) {
  const tz = zone(timeZone);
  const countries = places.filter(p => p.iso2);
  if (tz) {
    const hit = countries.find(p => zonesOf(p.iso2).some(z => zone(z) === tz));
    if (hit) return hit.id;
  }
  for (const language of languages) {
    const region = /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(language ?? '')?.[1]?.toUpperCase();
    const hit = region && countries.find(p => p.iso2 === region);
    if (hit) return hit.id;
  }
  return null;
}

/** The time zones of a country, as the browser knows them ([] where it can't say). */
export function browserZones(iso2) {
  try {
    const locale = new Intl.Locale('und', { region: iso2 });
    return locale.getTimeZones?.() ?? locale.timeZones ?? [];
  } catch { return []; }
}
