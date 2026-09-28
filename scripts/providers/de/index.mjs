// Germany: the Federal Foreign Office's (Auswärtiges Amt) travel and safety warnings.
//
// Source: its open-data API (no key), one request for every destination. Names are German,
// so places are matched by ISO alpha-3 code, as for the Netherlands. The flags are official
// fields, so a level change applies at once, as for Canada. Parsing is in ./parse.mjs.

import { parseWarnings } from './parse.mjs';

const API = 'https://www.auswaertiges-amt.de/opendata/travelwarning';
const HEADERS = { 'User-Agent': 'travel-risk-map (github.com)', Accept: 'application/json' };
const MIN_DESTINATIONS = 150;

export default {
  id: 'de',
  dataset: 'travel-advisories',
  source: API,

  /** `sleep` is injectable for tests. */
  async fetch({ log, previous, today, sleep = defaultSleep }) {
    const parsed = parseWarnings(JSON.parse(await get(log, API, sleep)));
    if (parsed.length < MIN_DESTINATIONS) throw new Error(`Parsed only ${parsed.length} destinations; the API format may have changed.`);
    const prev = new Map(previous.map(e => [e.name, e]));
    const levelChanged = parsed.filter(e => prev.has(e.name) && prev.get(e.name).level !== e.level)
      .map(e => `${e.name} L${prev.get(e.name).level} → L${e.level}`);
    const changed = parsed.filter(e => prev.has(e.name) && prev.get(e.name).updated !== e.updated).map(e => e.name);
    const entries = parsed.map(e => ({ ...e, lastSeen: today }));
    return { entries, stats: { destinations: entries.length, changed, levelChanged } };
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
    await sleep(attempt * 30000);
    return get(log, url, sleep, attempt + 1);
  }
}

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
