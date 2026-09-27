// Government of Canada travel advisories (travel.gc.ca).
//
// The advisory table gives each destination's level and "last updated" timestamp. What
// changed ("Latest updates") is only on each destination's own page, so those pages are
// read only when their timestamp changed since the previous snapshot. Parsing is in ./parse.mjs.

import { parseTable, parseLatestUpdate, planPageReads } from './parse.mjs';

const PAGE = 'https://travel.gc.ca/travelling/advisories';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (travel-risk-map)' };

export default {
  id: 'ca',
  dataset: 'travel-advisories',
  source: PAGE,

  // Change notes meaning nothing about the risk changed (see classifyUpdates in lib/build.mjs).
  minorChange: [
    /editorial change/i,
    /health section was updated - travel health information/i,   // generic health-info refresh
  ],

  async fetch({ log, previous }) {
    const entries = parseTable(await get(log, 'table', PAGE));
    // The table has ~230 rows; far fewer means the page layout changed.
    if (entries.length < 150) throw new Error(`Parsed only ${entries.length} destinations; page structure may have changed.`);

    const toRead = planPageReads(entries, previous);
    const failed = [];
    await pool(toRead, 4, async (e) => {
      try {
        const note = parseLatestUpdate(await get(log, 'pages', e.url, { detail: false }));
        if (note === null) throw new Error('no "Latest updates" label');
        e.change = note;
      } catch (err) {
        failed.push(e.name);
        console.warn(`  ${e.name}: could not read what changed (${err.message})`);
      }
    });
    if (failed.length) log.warn(`Could not read what changed for: ${failed.join(', ')}`);
    console.log(`Read ${toRead.length - failed.length} destination pages${failed.length ? `, ${failed.length} failed` : ''}, reused ${entries.length - toRead.length} notes.`);

    return {
      entries,
      stats: {
        destinations: entries.length,
        // Destinations whose timestamp changed since the previous run (all of them on a first run).
        changed: previous.length ? toRead.map(e => e.name) : `${toRead.length} (first run)`,
        pagesRead: toRead.length - failed.length,
        pagesFailed: failed.length,
        notesReused: entries.length - toRead.length,
      },
    };
  },
};

async function get(log, call, url, opts, attempt = 1) {
  try {
    const res = await log.request(call, url, { headers: HEADERS, signal: AbortSignal.timeout(30000) }, opts);
    if (res.challenge) throw new Error('Cloudflare challenge page instead of data');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.body;
  } catch (err) {
    if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
    await sleep(1500 * attempt);
    return get(log, call, url, opts, attempt + 1);
  }
}

// Run fn over items with a few requests in flight, pausing between them to stay polite.
async function pool(items, size, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
      await sleep(250);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
