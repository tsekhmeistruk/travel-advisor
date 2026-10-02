// USGS earthquakes: map markers in the Disasters mode for every earthquake of magnitude
// `minMagnitude` (5) or more in the last 7 days, worldwide. Never a level: GDACS's alerts set the
// disaster levels, and a quake GDACS reports is shown once (see the build's duplicates rule).
//
// Source: the USGS Earthquake Hazards Program's GeoJSON summary feeds (no key; public domain,
// U.S. Government work; credit USGS). The week of M4.5+ is one request (about 100 KB), updated
// every minute. Parsing is in ./parse.mjs, the merge with stored events in lib/events.mjs.

import { parseQuakes } from './parse.mjs';
import { mergeEvents } from '../../lib/events.mjs';

const FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson';
const HEADERS = { 'User-Agent': 'RiskMonitor/1.0 (https://github.com/tsekhmeistruk/travel-advisor)', Accept: 'application/geo+json, application/json' };

export default {
  id: 'usgs',
  kind: 'events',
  source: FEED,

  /** `sleep` is injectable for tests. */
  async fetch({ log, previous, now, config, sleep = defaultSleep }) {
    const quakes = parseQuakes(await get(log, FEED, sleep)).filter(q => q.magnitude >= config.minMagnitude);
    const incoming = quakes.map(({ magnitude, ...event }) => event);
    const { events, expired, stats } = mergeEvents(previous, incoming, { at: now.toISOString(), lookbackDays: config.lookbackDays, retainEndedDays: config.retainEndedDays });
    return {
      events,
      expired,
      stats: { events: events.length, current: 0, received: quakes.length, added: stats.added, archived: expired.length },
    };
  },
};

async function get(log, url, sleep, attempt = 1) {
  try {
    const res = await log.request('feed', url, { headers: HEADERS, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.body;
  } catch (err) {
    if (attempt >= 3) throw new Error(`USGS feed failed after ${attempt} attempts: ${err.message}`);
    await sleep(attempt * 20000);
    return get(log, url, sleep, attempt + 1);
  }
}

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
