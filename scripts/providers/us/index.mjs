// U.S. State Department travel advisories.
//
// Levels and dates come from the public data API (the same data as travel.state.gov, whose
// pages sit behind a bot check); "what changed" notes come from the RSS feed, which lags the
// API for some countries. Parsing and the merge with the previous snapshot are in ./parse.mjs.

import { parseApiItems, mergeWithPrevious, parseRssNotes, attachNotes } from './parse.mjs';

const API = 'https://cadataapi.state.gov/api/TravelAdvisories';
const RSS = 'https://travel.state.gov/_res/rss/TAsTWs.xml';
const HEADERS = { 'User-Agent': 'travel-risk-map (github.com)' };
const MISSING_GRACE_DAYS = 7;

export default {
  id: 'us',
  dataset: 'travel-advisories',
  source: API,

  // Change notes meaning nothing about the risk changed (see classifyUpdates in lib/build.mjs).
  minorChange: [
    /(reissued|updated) after periodic review,? (without changes|with minor edits)\.?$/i,
    /reissued with obsolete .*links? removed/i,
  ],

  /** Fetch and merge with the previous snapshot's entries. */
  async fetch({ log, previous, today }) {
    const items = await fetchApi(log);
    const { byName, duplicates, warnings } = parseApiItems(items, previous, today);
    warnings.forEach(w => log.warn(w));
    if (byName.size < 150) throw new Error(`Parsed only ${byName.size} advisories; the API format may have changed.`);
    const fromApi = byName.size;

    const { entries, stale, carried, dropped } = mergeWithPrevious(byName, previous, today, MISSING_GRACE_DAYS);
    if (stale.length) log.warn(`Ignored outdated API copies: ${stale.join('; ')}`);
    if (carried.length) console.log(`Kept from previous snapshot (missing from this response): ${carried.join(', ')}`);
    if (dropped.length) log.warn(`Dropped after ${MISSING_GRACE_DAYS} days missing from the API: ${dropped.join(', ')}`);

    // "What changed" notes are optional: continue without them if the feed fails.
    let notesMatched = null;
    try {
      notesMatched = attachNotes(entries, await fetchRssNotes(log));
      console.log(`Change notes from RSS: ${notesMatched} of ${entries.length}.`);
    } catch (err) {
      log.warn(`RSS change notes unavailable (${err.message}); continued without them.`);
    }

    return {
      entries,
      stats: {
        apiItems: items.length,
        duplicates,
        fromApi,
        advisories: entries.length,
        staleIgnored: stale.length,
        keptFromPrevious: carried,
        droppedMissing: dropped,
        changeNotes: notesMatched,
      },
    };
  },
};

// The API sits behind Cloudflare, which sometimes answers with a challenge page or
// HTTP 429 instead of JSON (more often after several calls in a row). Wait and retry.
async function fetchApi(log) {
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
      await new Promise(r => setTimeout(r, attempt * 60000));
    }
  }
}

async function fetchRssNotes(log) {
  const res = await log.request('rss', RSS, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (res.challenge) throw new Error('Cloudflare challenge page instead of data');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseRssNotes(res.body);
}
