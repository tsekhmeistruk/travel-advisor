// WHO Disease Outbreak News: official notices of outbreaks of international concern.
//
// Source: the WHO public API (OData, no key), newest first. One request for the latest 30
// notices, of which those of the last `lookbackDays` are kept; WHO publishes a few a month.
// Each notice is one event of type "outbreak" in the health category (config/sources/who.json).
// Parsing is in ./parse.mjs, the merge with stored events in lib/events.mjs.

import { parseNotices } from './parse.mjs';
import { mergeEvents } from '../../lib/events.mjs';

const API = 'https://www.who.int/api/news/diseaseoutbreaknews';
const QUERY = '$orderby=PublicationDate%20desc&$top=30&$select=DonId,Title,OverrideTitle,UseOverrideTitle,PublicationDate';
const HEADERS = { 'User-Agent': 'travel-risk-map (github.com)', Accept: 'application/json' };

export default {
  id: 'who',
  kind: 'events',
  source: API,

  /** `sleep` is injectable for tests. */
  async fetch({ log, previous, now, config, sleep = defaultSleep }) {
    const notices = parseNotices(await get(log, `${API}?${QUERY}`, sleep));
    // An empty list would mean the API changed: WHO has published notices every month for years.
    if (!notices.length) throw new Error('WHO returned no notices; the API may have changed.');
    const cutoff = +now - config.lookbackDays * 864e5;
    const recent = notices.filter(n => Date.parse(n.startedAt) >= cutoff);
    const { events, expired, stats } = mergeEvents(previous, recent, { at: now.toISOString(), lookbackDays: config.lookbackDays, retainEndedDays: config.retainEndedDays });
    return {
      events,
      expired,
      stats: { events: events.length, current: 0, received: notices.length, added: stats.added, archived: expired.length },
    };
  },
};

async function get(log, url, sleep, attempt = 1) {
  try {
    const res = await log.request('api', url, { headers: HEADERS, signal: AbortSignal.timeout(60000) });
    if (res.challenge) throw new Error('challenge page instead of data');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.body;
  } catch (err) {
    if (attempt >= 3) throw new Error(`API failed after ${attempt} attempts: ${err.message}`);
    console.warn(`API attempt ${attempt} failed (${err.message}); retrying.`);
    await sleep(attempt * 30000);
    return get(log, url, sleep, attempt + 1);
  }
}

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
