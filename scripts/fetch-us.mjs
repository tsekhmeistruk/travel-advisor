// Downloads U.S. State Department travel advisories from its public data API
// (the same data as travel.state.gov) and saves them as data/sources/us.json.
// Run scripts/build-data.mjs afterwards. Each run is logged to logs/fetch/.
//
// Why the API: the travel.state.gov page sits behind a bot check, and the RSS feed
// lags the page for some countries. The API matches the page's levels and dates.
// Parsing and the merge with the previous snapshot are in scripts/lib/us.mjs.
//
// Usage: node scripts/fetch-us.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withRunLog } from './lib/fetch-log.mjs';
import { parseApiItems, mergeWithPrevious, parseRssNotes, attachNotes } from './lib/us.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'data', 'sources', 'us.json');
const MISSING_GRACE_DAYS = 7;
const API = 'https://cadataapi.state.gov/api/TravelAdvisories';
const RSS = 'https://travel.state.gov/_res/rss/TAsTWs.xml';
const HEADERS = { 'User-Agent': 'travel-risk-map (github.com)' };

await withRunLog('us', async (log) => {
  const today = new Date().toISOString().slice(0, 10);
  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).entries : [];

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

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), source: API, entries }, null, 1) + '\n');
  console.log(`Saved ${entries.length} U.S. advisories.`);

  log.stat({
    apiItems: items.length,
    duplicates,
    fromApi,
    advisories: entries.length,
    staleIgnored: stale.length,
    keptFromPrevious: carried,
    droppedMissing: dropped,
    changeNotes: notesMatched,
  });
});

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
