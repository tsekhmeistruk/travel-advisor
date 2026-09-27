// GDACS (Global Disaster Alert and Coordination System): earthquakes, tropical cyclones,
// floods, volcanoes, droughts and forest fires, with Green / Orange / Red alert levels.
//
// Source: the public GDACS API (no key), search endpoint, newest first, pages of at most 100.
// Only Orange and Red alerts are fetched: they are the ones that raise a level. (Green alerts
// number several hundred a week, mostly small forest fires.) The window is the last
// `lookbackDays` days, so ongoing events and their latest episode are always included.
// Parsing is in ./parse.mjs, the merge with stored events in lib/events.mjs.

import { parseEvents } from './parse.mjs';
import { mergeEvents } from '../../lib/events.mjs';

const SEARCH = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/search';
const HEADERS = { 'User-Agent': 'travel-risk-map (github.com)', Accept: 'application/json' };
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export default {
  id: 'gdacs',
  kind: 'events',
  source: SEARCH,

  /**
   * @param previous  stored events;  config  config/sources/gdacs.json
   * `sleep` is injectable for tests.
   */
  async fetch({ log, previous, now, config, sleep = defaultSleep }) {
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const query = new URLSearchParams({
      eventlist: Object.keys(config.types).join(';'),
      alertlevel: 'Orange;Red',
      fromDate: day(now - config.lookbackDays * 864e5),
      toDate: day(+now),
      pageSize: String(PAGE_SIZE),
    });
    const incoming = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = parseEvents(await get(log, `${SEARCH}?${query}&pageNumber=${page}`, sleep));
      incoming.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      if (page === MAX_PAGES) log.warn(`More than ${MAX_PAGES * PAGE_SIZE} events; the rest were not fetched.`);
    }

    const unknown = [...new Set(incoming.map(e => e.code).filter(c => !config.types[c]))];
    if (unknown.length) log.warn(`Event types not in config/sources/gdacs.json: ${unknown.join(', ')}`);
    // An empty list is possible (a quiet month), but after a busy one it more likely means trouble.
    if (!incoming.length && previous.some(e => e.current)) log.warn('No Orange or Red events returned, although some were current last time.');

    const { events, expired, stats } = mergeEvents(previous, incoming, { at: now.toISOString(), lookbackDays: config.lookbackDays, retainEndedDays: config.retainEndedDays });
    if (stats.levelChanged.length) console.log(`Alert level changed: ${stats.levelChanged.join('; ')}`);
    return {
      events,
      expired,
      stats: {
        events: events.length,
        current: events.filter(e => e.current).length,
        received: stats.received,
        added: stats.added,
        alertChanged: stats.levelChanged,
        closed: stats.closed,
        archived: stats.expired,
      },
    };
  },
};

// Counted, not listed per attempt: two pages must not look like a retry in the log.
async function get(log, url, sleep, attempt = 1) {
  try {
    const res = await log.request('search', url, { headers: HEADERS, signal: AbortSignal.timeout(60000) }, { detail: false });
    if (res.challenge) throw new Error('challenge page instead of data');
    if (res.status === 204) return '';
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.body;
  } catch (err) {
    if (attempt >= 3) throw new Error(`Search failed after ${attempt} attempts: ${err.message}`);
    console.warn(`Search attempt ${attempt} failed (${err.message}); retrying.`);
    await sleep(attempt * 30000);
    return get(log, url, sleep, attempt + 1);
  }
}

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
