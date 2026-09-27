// Netherlands (Ministry of Foreign Affairs, "Nederland Wereldwijd") travel advice.
//
// Source: the open-data API v2 (CC0). The advisory list has every destination with its ISO
// alpha-3 code, Dutch summary and last-modified date, in pages of up to 200. The colour code
// is read from the summary (./parse.mjs), so a level change is applied only once a fetch on a
// later day confirms it (shared merge rules in lib/merge.mjs).

import { listDocuments, parseAdvisories } from './parse.mjs';
import { mergeWithPrevious } from '../../lib/merge.mjs';

const LIST = 'https://opendata.nederlandwereldwijd.nl/v2/sources/nederlandwereldwijd/infotypes/traveladvice';
const HEADERS = { 'User-Agent': 'travel-risk-map (github.com)', Accept: 'application/json' };
const PAGE_SIZE = 200;
const MAX_PAGES = 5;
const MIN_ADVISORIES = 150;
const MISSING_GRACE_DAYS = 7;

export default {
  id: 'nl',
  dataset: 'travel-advisories',
  source: LIST,

  /** `sleep` is injectable for tests. */
  async fetch({ log, previous, today, sleep = defaultSleep }) {
    const docs = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await get(log, `${LIST}?output=json&rows=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, sleep);
      const batch = listDocuments(JSON.parse(body));
      docs.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }

    const { entries: parsed, rules, severest, unreadable } = parseAdvisories(docs);
    if (unreadable.length) log.warn(`No colour code found in the summary of: ${unreadable.join(', ')}`);
    if (parsed.length < MIN_ADVISORIES) throw new Error(`Parsed only ${parsed.length} advisories; the API format may have changed.`);
    // The fallback rule should stay rare; a jump means the summary wording changed.
    if (severest.length > 10) log.warn(`${severest.length} summaries needed the most-severe-colour fallback; the wording may have changed.`);

    const byName = new Map(parsed.map(e => [e.name, { ...e, lastSeen: today }]));
    const { entries, stale, carried, dropped, unconfirmed, confirmed } = mergeWithPrevious(byName, previous, today, MISSING_GRACE_DAYS);
    if (stale.length) log.warn(`Ignored outdated copies: ${stale.join('; ')}`);
    if (unconfirmed.length) log.warn(`Unconfirmed level changes (waiting for a later fetch): ${unconfirmed.join('; ')}`);
    if (confirmed.length) console.log(`Confirmed level changes: ${confirmed.join('; ')}`);
    if (dropped.length) log.warn(`Dropped after ${MISSING_GRACE_DAYS} days missing: ${dropped.join(', ')}`);
    console.log(`${entries.length} Dutch advisories (${JSON.stringify(rules)}).`);

    return {
      entries,
      stats: {
        advisories: entries.length,
        levelRules: rules,
        severestFallback: severest,
        keptFromPrevious: carried,
        droppedMissing: dropped,
        levelChangesPending: unconfirmed.length,
        levelChangesConfirmed: confirmed,
        staleIgnored: stale.length,
      },
    };
  },
};

async function get(log, url, sleep, attempt = 1) {
  try {
    // Counted, not listed per attempt: two pages must not look like a retry in the log.
    const res = await log.request('list', url, { headers: HEADERS, signal: AbortSignal.timeout(60000) }, { detail: false });
    if (res.challenge) throw new Error('Cloudflare challenge page instead of data');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!/^\s*[[{]/.test(res.body)) throw new Error('non-JSON response');
    return res.body;
  } catch (err) {
    if (attempt >= 3) throw new Error(`List failed after ${attempt} attempts: ${err.message}`);
    console.warn(`List attempt ${attempt} failed (${err.message}); retrying.`);
    await sleep(attempt * 30000);
    return get(log, url, sleep, attempt + 1);
  }
}

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
