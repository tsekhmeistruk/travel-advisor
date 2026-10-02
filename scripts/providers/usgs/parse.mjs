// Parsing for the USGS earthquake feeds (pure; the network side lives in ./index.mjs).
//
// The feed is GeoJSON: one Point feature per earthquake (longitude, latitude, depth in km), with
// its magnitude, time (Unix ms), a place description ("165 km SSE of Vilyuchinsk, Russia") and
// a link to its USGS page. Only the source's facts are kept, as an event: the magnitude class is
// its native value ("M5" for 5.0–5.9), the country the end of the place description. These are
// map markers only (config `markersOnly`): an earthquake never sets a level here, GDACS's alerts do.

export const SCHEME = 'usgs-magnitude';

/** Earthquakes from one response body. Throws when it isn't a GeoJSON list. */
export function parseQuakes(body) {
  let json;
  try { json = JSON.parse(body); } catch { throw new Error('USGS response is not JSON'); }
  if (!Array.isArray(json?.features)) throw new Error('USGS response has no list of features');
  return json.features.filter(f => (f?.properties?.type ?? 'earthquake') === 'earthquake').map(parseQuake);
}

export function parseQuake(f) {
  const p = f?.properties ?? {};
  const [lon, lat, depth] = f?.geometry?.type === 'Point' ? f.geometry.coordinates : [];
  if (!f?.id || !Number.isFinite(p.mag) || !Number.isFinite(p.time) || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(`USGS earthquake without id, magnitude, time or point: ${JSON.stringify(f).slice(0, 120)}`);
  }
  const at = new Date(p.time).toISOString();
  // "165 km SSE of Vilyuchinsk, Russia" -> Russia; "south of the Fiji Islands" (at sea) -> none.
  const country = p.place?.includes(', ') ? p.place.split(', ').at(-1).trim() : undefined;
  return {
    id: `usgs:${f.id}`,
    code: 'EQ',
    name: p.title || `M ${p.mag} - ${p.place ?? ''}`.trim(),
    country,
    iso3: [],
    point: { lon: round(lon), lat: round(lat) },
    native: { scheme: SCHEME, value: `M${Math.min(9, Math.max(0, Math.floor(p.mag)))}` },
    magnitude: p.mag,
    severity: `Magnitude ${p.mag}${p.magType ? ` ${p.magType}` : ''}${Number.isFinite(depth) ? `, depth ${Math.round(depth)} km` : ''}`,
    startedAt: at,
    toDate: at,
    current: false,   // a moment, not an ongoing event: shown for its type's tail (tailDays)
    url: p.url,
  };
}

const round = (x) => Math.round(x * 1000) / 1000;
