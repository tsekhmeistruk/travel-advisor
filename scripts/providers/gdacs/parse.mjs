// Parsing for GDACS (Global Disaster Alert and Coordination System) event lists (pure; the
// network side lives in ./index.mjs).
//
// The search endpoint answers with a GeoJSON FeatureCollection, one Point feature per event,
// newest first. A feature is one event at its latest episode: an earthquake has one episode, a
// cyclone or flood gets a new one with every update, and its alert level can change between
// episodes. Only the source's facts are kept here: its alert level ("native" value), dates,
// countries and position. Our level, category and places are derived in the build from
// config/sources/gdacs.json, so a mapping change applies to every stored event.
//
// Fields that change on every request without meaning anything (datemodified, icons) are left
// out, so the committed events file only changes when an event does.

export const SCHEME = 'gdacs-alert';

/** Events from one response body: [] for an empty body (HTTP 204 means "no events"). */
export function parseEvents(body) {
  if (!body.trim()) return [];
  let json;
  try { json = JSON.parse(body); } catch { throw new Error('GDACS response is not JSON'); }
  if (!Array.isArray(json?.features)) throw new Error('GDACS response has no list of features');
  return json.features.map(parseFeature);
}

export function parseFeature(f) {
  const p = f?.properties ?? {};
  for (const key of ['eventtype', 'eventid', 'alertlevel', 'fromdate', 'todate']) {
    if (p[key] == null || p[key] === '') throw new Error(`GDACS event without ${key}: ${JSON.stringify(p).slice(0, 120)}`);
  }
  const [lon, lat] = f.geometry?.type === 'Point' ? f.geometry.coordinates : [];
  const iso3 = [...new Set([p.iso3, ...(p.affectedcountries ?? []).map(c => c.iso3)].filter(Boolean))];
  return {
    id: `gdacs:${p.eventtype}:${p.eventid}`,
    code: p.eventtype,
    name: p.name || p.eventname || `${p.eventtype} ${p.eventid}`,
    country: p.country || undefined,
    iso3,
    point: Number.isFinite(lon) && Number.isFinite(lat) ? { lon: round(lon), lat: round(lat) } : undefined,
    native: { scheme: SCHEME, value: p.alertlevel },
    episode: p.episodeid,
    severity: p.severitydata?.severitytext || undefined,
    startedAt: utc(p.fromdate),
    toDate: utc(p.todate),
    current: String(p.iscurrent) === 'true',
    url: p.url?.report,
  };
}

// GDACS times have no zone; they are UTC.
export function utc(stamp) {
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(stamp) ? stamp : `${stamp}Z`;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`GDACS date "${stamp}" is not a date`);
  return new Date(ms).toISOString();
}

const round = (x) => Math.round(x * 1000) / 1000;
