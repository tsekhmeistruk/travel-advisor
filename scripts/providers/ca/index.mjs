// Government of Canada travel advisories.
//
// Primary source: the official open-data JSON feed (Global Affairs Canada, Open Government
// Licence - Canada): all destinations, with notes and an official change type, in one request.
// It's rebuilt about once a day, so the live advisory table on travel.gc.ca is also read:
// destinations updated since the feed was built take the table's data, and only their pages
// are read for "what changed". Either source alone is enough if the other fails.
// Parsing and combining are in ./parse.mjs.

import { parseFeed, parseTable, parseLatestUpdate, combineSources, planPageReads } from './parse.mjs';

const FEED = 'https://data.international.gc.ca/travel-voyage/index-updated.json';
const PAGE = 'https://travel.gc.ca/travelling/advisories';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (travel-risk-map)' };
const MIN_DESTINATIONS = 150;   // ~230 in practice; far fewer means a format change

export default {
  id: 'ca',
  dataset: 'travel-advisories',
  source: FEED,

  // Canada labels every update with a type; these mean nothing about the risk changed.
  minorChangeTypes: ['Editorial change'],
  // Fallback for updates without a type (read from a page): notes meaning "editorial only".
  minorChange: [
    /editorial change/i,
    /health section was updated - travel health information/i,   // generic health-info refresh
  ],

  /** `sleep` is injectable for tests. */
  async fetch({ log, previous, sleep = defaultSleep }) {
    const failures = [];
    const feed = await trySource('feed', async () => {
      const { generated, entries } = parseFeed(JSON.parse(await get(log, 'feed', FEED, undefined, sleep)));
      if (entries.length < MIN_DESTINATIONS) throw new Error(`only ${entries.length} destinations`);
      return { generated, entries };
    });
    const table = await trySource('table', async () => {
      const entries = parseTable(await get(log, 'table', PAGE, undefined, sleep));
      if (entries.length < MIN_DESTINATIONS) throw new Error(`only ${entries.length} destinations; page structure may have changed`);
      return entries;
    });
    if (!feed && !table) throw new Error(`Both sources failed. ${failures.join(' ')}`);
    failures.forEach(f => log.warn(f));

    const { entries, newerInTable } = combineSources(feed?.entries ?? [], table ?? []);

    // "What changed" for destinations the feed doesn't cover yet: reuse a note already on
    // file for the same timestamp, otherwise read the destination's page.
    const toRead = planPageReads(entries.filter(e => e.change === undefined), previous);
    const failed = [];
    await pool(toRead, 4, sleep, async (e) => {
      try {
        const note = parseLatestUpdate(await get(log, 'pages', e.url, { detail: false }, sleep));
        if (note === null) throw new Error('no "Latest updates" label');
        e.change = note;
      } catch (err) {
        failed.push(e.name);
        console.warn(`  ${e.name}: could not read what changed (${err.message})`);
      }
    });
    if (failed.length) log.warn(`Could not read what changed for: ${failed.join(', ')}`);

    // Destinations whose timestamp changed since the previous run (all of them on a first run).
    const before = new Map(previous.map(e => [e.name, e.stamp]));
    const changed = previous.length ? entries.filter(e => before.get(e.name) !== e.stamp).map(e => e.name) : `${entries.length} (first run)`;
    console.log(`${entries.length} destinations from ${[feed && 'feed', table && 'table'].filter(Boolean).join(' + ')}; `
      + `${newerInTable.length} newer on the website than the feed; read ${toRead.length - failed.length} pages.`);

    return {
      entries,
      stats: {
        destinations: entries.length,
        sources: [feed && 'feed', table && 'table'].filter(Boolean),
        feedGenerated: feed?.generated ?? null,
        newerThanFeed: newerInTable,
        changed,
        pagesRead: toRead.length - failed.length,
        pagesFailed: failed.length,
      },
    };

    async function trySource(name, load) {
      try { return await load(); } catch (err) {
        failures.push(`Canada ${name} unavailable (${err.message}); used the other source.`);
        return null;
      }
    }
  },
};

async function get(log, call, url, opts, sleep, attempt = 1) {
  try {
    const res = await log.request(call, url, { headers: HEADERS, signal: AbortSignal.timeout(30000) }, opts);
    if (res.challenge) throw new Error('Cloudflare challenge page instead of data');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.body;
  } catch (err) {
    if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
    await sleep(1500 * attempt);
    return get(log, call, url, opts, sleep, attempt + 1);
  }
}

// Run fn over items with a few requests in flight, pausing between them to stay polite.
async function pool(items, size, sleep, fn) {
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

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
