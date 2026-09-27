// GDACS (Global Disaster Alert and Coordination System): earthquakes, tropical cyclones,
// floods, volcanoes, droughts and forest fires, with Green / Orange / Red alert levels.
//
// Source: the public GDACS API (no key), search endpoint, newest first, pages of at most 100.
// Two queries:
//   major  Orange and Red alerts of every type over `lookbackDays`: the ones that raise a level
//   minor  Green alerts of `minor.types` (cyclones, floods, volcanoes) over `minor.lookbackDays`,
//          for map markers only. Green earthquakes and forest fires are left out: several
//          hundred a week, too many to show and too small to matter.
// Ongoing events and their latest episode are always inside the windows. Ended minor events
// are dropped after `minor.retainEndedDays`, major ones after `retainEndedDays`.
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
    const queries = [
      { name: 'major', types: Object.keys(config.types), alertlevel: 'Orange;Red', days: config.lookbackDays },
      ...(config.minor ? [{ name: 'minor', types: config.minor.types, alertlevel: 'Green', days: config.minor.lookbackDays }] : []),
    ];
    const incoming = [];
    for (const q of queries) {
      const query = new URLSearchParams({
        eventlist: q.types.join(';'), alertlevel: q.alertlevel, fromDate: day(now - q.days * 864e5), toDate: day(+now), pageSize: String(PAGE_SIZE),
      });
      for (let page = 1; page <= MAX_PAGES; page++) {
        const batch = parseEvents(await get(log, `${SEARCH}?${query}&pageNumber=${page}`, sleep));
        incoming.push(...batch);
        if (batch.length < PAGE_SIZE) break;
        if (page === MAX_PAGES) log.warn(`More than ${MAX_PAGES * PAGE_SIZE} ${q.name} events; the rest were not fetched.`);
      }
    }

    const unknown = [...new Set(incoming.map(e => e.code).filter(c => !config.types[c]))];
    if (unknown.length) log.warn(`Event types not in config/sources/gdacs.json: ${unknown.join(', ')}`);
    // An empty list is possible (a quiet month), but after a busy one it more likely means trouble.
    if (!incoming.length && previous.some(e => e.current)) log.warn('No events returned, although some were current last time.');

    // Ended minor (Green) events are kept a shorter time: they only ever were markers. The API's
    // window still lists events that ended on its first day, so one already past that time is
    // ignored, not added and archived again on every run.
    const minorCutoff = config.minor ? +now - config.minor.retainEndedDays * 864e5 : -Infinity;
    const isOldMinor = (e) => !e.current && e.native.value === 'Green' && Date.parse(e.toDate) < minorCutoff;
    const known = new Set(previous.map(e => e.id));
    const merged = mergeEvents(previous, incoming.filter(e => known.has(e.id) || !isOldMinor(e)), { at: now.toISOString(), lookbackDays: config.lookbackDays, retainEndedDays: config.retainEndedDays });
    const { stats } = merged;
    const events = merged.events.filter(e => !isOldMinor(e));
    const expired = [...merged.expired, ...merged.events.filter(isOldMinor)];
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
        archived: expired.length,
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
