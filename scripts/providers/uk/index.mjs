// UK Foreign, Commonwealth & Development Office (FCDO) foreign travel advice.
//
// Source: the GOV.UK Content API (no key, Open Government Licence v3.0). One request for the
// index, which lists every destination with its last-published time, then one request per
// destination whose page changed since the previous snapshot (every page on the first run,
// a few a day after that). The warnings on each page set the level (./parse.mjs). They are
// official fields, so a level change applies at once, as for Canada.

import { parseIndex, parsePage } from './parse.mjs';

const INDEX = 'https://www.gov.uk/api/content/foreign-travel-advice';
const HEADERS = { 'User-Agent': 'travel-risk-map (github.com)', Accept: 'application/json' };
const MIN_DESTINATIONS = 150;
const CONCURRENCY = 4;
// A few failed pages keep their previous entry; many mean something is wrong.
const MAX_FAILED_PAGES = 10;

export default {
  id: 'uk',
  dataset: 'travel-advisories',
  source: INDEX,

  /** `sleep` is injectable for tests. */
  async fetch({ log, previous, today, sleep = defaultSleep }) {
    const index = parseIndex(JSON.parse(await get(log, 'index', INDEX, sleep, { detail: true })));
    if (index.length < MIN_DESTINATIONS) throw new Error(`Only ${index.length} destinations in the index; the API format may have changed.`);

    const prevByName = new Map(previous.map(e => [e.name, e]));
    const toRead = index.filter(d => prevByName.get(d.name)?.stamp !== d.stamp);
    const read = new Map();
    const failed = [];
    let next = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (next < toRead.length) {
        const d = toRead[next++];
        try {
          read.set(d.name, parsePage(JSON.parse(await get(log, 'pages', d.apiUrl, sleep, { detail: false }))));
        } catch (err) {
          failed.push(`${d.name} (${err.message})`);
        }
      }
    }));
    if (failed.length > MAX_FAILED_PAGES) throw new Error(`${failed.length} destination pages failed, e.g. ${failed.slice(0, 3).join('; ')}`);
    if (failed.length) log.warn(`Pages failed, previous entry kept: ${failed.join('; ')}`);

    const entries = [];
    const levelChanged = [];
    for (const d of index) {
      const prev = prevByName.get(d.name);
      const page = read.get(d.name);
      if (!page) {   // unchanged, or its page failed: keep the previous entry
        if (prev) entries.push({ ...prev, lastSeen: today });
        continue;
      }
      if (prev && prev.level !== page.level) levelChanged.push(`${d.name} L${prev.level} → L${page.level}`);
      entries.push({
        name: d.name, level: page.level, updated: d.stamp.slice(0, 10), stamp: d.stamp, url: d.url,
        regional: page.regional || undefined, alerts: page.alerts.length ? page.alerts : undefined, lastSeen: today,
      });
    }
    return {
      entries,
      stats: { destinations: entries.length, changed: toRead.map(d => d.name).filter(n => read.has(n) && prevByName.has(n)), levelChanged, pagesFailed: failed.length },
    };
  },
};

async function get(log, call, url, sleep, opts, attempt = 1) {
  try {
    const res = await log.request(call, url, { headers: HEADERS, signal: AbortSignal.timeout(60000) }, opts);
    if (res.challenge) throw new Error('challenge page instead of data');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.body;
  } catch (err) {
    if (attempt >= 3) throw new Error(`${call} failed after ${attempt} attempts: ${err.message}`);
    await sleep(attempt * 15000);
    return get(log, call, url, sleep, opts, attempt + 1);
  }
}

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
