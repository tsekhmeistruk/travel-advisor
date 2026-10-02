// NASA EONET volcanoes: map markers in the Disasters mode for the volcanoes with an open event
// (eruptions and unrest the Smithsonian's weekly volcano report tracks). Never a level, and a
// volcano GDACS reports is shown once (see the build's duplicates rule).
//
// Source: EONET v3 (eonet.gsfc.nasa.gov, no key; NASA open data, credit NASA EONET). Only
// volcanoes are asked for: EONET's open wildfires are thousands of small U.S. fires, and its
// storms are the tropical cyclones GDACS already reports. One request (about 30 KB).

import { parseEvents } from './parse.mjs';
import { mergeEvents } from '../../lib/events.mjs';

const API = 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&category=volcanoes';
const HEADERS = { 'User-Agent': 'RiskMonitor/1.0 (https://github.com/tsekhmeistruk/travel-advisor)', Accept: 'application/geo+json, application/json' };

export default {
  id: 'eonet',
  kind: 'events',
  source: API,

  /** `sleep` is injectable for tests. */
  async fetch({ log, previous, now, config, sleep = defaultSleep }) {
    const incoming = parseEvents(await get(log, API, sleep));
    // Open events of every age come back each time: an event no longer listed has closed.
    const open = new Set(incoming.map(e => e.id));
    const at = now.toISOString();
    const before = previous.map(e => (e.current && !open.has(e.id) ? { ...e, current: false, toDate: at } : e));
    const { events, expired, stats } = mergeEvents(before, incoming, { at, lookbackDays: config.lookbackDays, retainEndedDays: config.retainEndedDays });
    return {
      events,
      expired,
      stats: { events: events.length, current: events.filter(e => e.current).length, received: incoming.length, added: stats.added, archived: expired.length },
    };
  },
};

async function get(log, url, sleep, attempt = 1) {
  try {
    const res = await log.request('api', url, { headers: HEADERS, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.body;
  } catch (err) {
    if (attempt >= 3) throw new Error(`EONET failed after ${attempt} attempts: ${err.message}`);
    await sleep(attempt * 20000);
    return get(log, url, sleep, attempt + 1);
  }
}

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
