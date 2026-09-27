// U.S. State Department travel advisories.
//
// Levels and dates come from the public data API (the same data as travel.state.gov, whose
// pages sit behind a bot check). Parsing and the merge with the previous snapshot are in
// ./parse.mjs.

import { parseApiItems, mergeWithPrevious } from './parse.mjs';

const API = 'https://cadataapi.state.gov/api/TravelAdvisories';
const HEADERS = { 'User-Agent': 'travel-risk-map (github.com)' };
const MISSING_GRACE_DAYS = 7;

export default {
  id: 'us',
  dataset: 'travel-advisories',
  source: API,

  /** Fetch and merge with the previous snapshot's entries. `sleep` is injectable for tests. */
  async fetch({ log, previous, today, sleep = defaultSleep }) {
    const items = await fetchApi(log, sleep);
    const { byName, duplicates, warnings } = parseApiItems(items, previous, today);
    warnings.forEach(w => log.warn(w));
    if (byName.size < 150) throw new Error(`Parsed only ${byName.size} advisories; the API format may have changed.`);
    const fromApi = byName.size;

    const { entries, stale, carried, dropped, unconfirmed, confirmed } = mergeWithPrevious(byName, previous, today, MISSING_GRACE_DAYS);
    if (stale.length) log.warn(`Ignored outdated API copies: ${stale.join('; ')}`);
    if (unconfirmed.length) log.warn(`Unconfirmed level changes (waiting for a later fetch): ${unconfirmed.join('; ')}`);
    if (confirmed.length) console.log(`Confirmed level changes: ${confirmed.join('; ')}`);
    if (carried.length) console.log(`Kept from previous snapshot (missing from this response): ${carried.join(', ')}`);
    if (dropped.length) log.warn(`Dropped after ${MISSING_GRACE_DAYS} days missing from the API: ${dropped.join(', ')}`);

    return {
      entries,
      stats: {
        apiItems: items.length,
        duplicates,
        fromApi,
        advisories: entries.length,
        staleIgnored: stale.length,
        levelChangesPending: unconfirmed.length,
        levelChangesConfirmed: confirmed,
        keptFromPrevious: carried,
        droppedMissing: dropped,
      },
    };
  },
};

// The API sits behind Cloudflare, which sometimes answers with a challenge page or
// HTTP 429 instead of JSON (more often after several calls in a row). Wait and retry.
async function fetchApi(log, sleep) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await log.request('api', API, { headers: { ...HEADERS, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      if (res.challenge) throw new Error('Cloudflare challenge page instead of data');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body.trimStart().startsWith('[')) throw new Error('non-JSON response');
      return JSON.parse(res.body);
    } catch (err) {
      if (attempt >= 3) throw new Error(`API failed after ${attempt} attempts: ${err.message}`);
      console.warn(`API attempt ${attempt} failed (${err.message}); retrying in ${attempt} min.`);
      await sleep(attempt * 60000);
    }
  }
}

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
