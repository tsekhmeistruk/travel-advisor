// Parsing for NASA EONET's open events (pure; the network side lives in ./index.mjs).
//
// EONET (the Earth Observatory Natural Event Tracker) lists natural events with their sources;
// its GeoJSON has one Point feature per position and date of an event, so an event with a
// track (a storm) or several reports (a volcano) comes several times. Each event is kept once:
// its first date, its latest date and point, its title ("Telica Volcano, Nicaragua") and the
// country at the end of the title. Only volcanoes are asked for (see ./index.mjs). Map markers
// only (config `markersOnly`): never a level.

export const SCHEME = 'eonet-status';
// EONET's categories this site reads, as event codes (config types): volcanoes only.
const TYPES = { volcanoes: 'VO' };

/** Events from one response body, one per EONET event id. Throws when it isn't a GeoJSON list. */
export function parseEvents(body) {
  let json;
  try { json = JSON.parse(body); } catch { throw new Error('EONET response is not JSON'); }
  if (!Array.isArray(json?.features)) throw new Error('EONET response has no list of features');
  const byId = new Map();
  for (const f of json.features) {
    const p = f?.properties ?? {};
    const [lon, lat] = f?.geometry?.type === 'Point' ? f.geometry.coordinates : [];
    if (!p.id || !p.title || !p.date || !Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`EONET event without id, title, date or point: ${JSON.stringify(p).slice(0, 120)}`);
    }
    const code = TYPES[p.categories?.[0]?.id];
    if (!code) continue;
    const at = new Date(p.date).toISOString();
    const prev = byId.get(p.id);
    if (prev && prev.toDate >= at) { if (at < prev.startedAt) prev.startedAt = at; continue; }
    byId.set(p.id, {
      id: `eonet:${p.id}`,
      code,
      name: p.title,
      // "Telica Volcano, Nicaragua" -> Nicaragua
      country: p.title.includes(', ') ? p.title.split(', ').at(-1).trim() : undefined,
      iso3: [],
      point: { lon: round(lon), lat: round(lat) },
      native: { scheme: SCHEME, value: p.closed ? 'closed' : 'open' },
      startedAt: prev ? (prev.startedAt < at ? prev.startedAt : at) : at,
      toDate: p.closed ? new Date(p.closed).toISOString() : at,
      current: !p.closed,
      // Some source links are http (the Smithsonian's pages serve https too).
      url: (p.sources?.[0]?.url ?? p.link)?.replace(/^http:\/\//, 'https://'),
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const round = (x) => Math.round(x * 1000) / 1000;
