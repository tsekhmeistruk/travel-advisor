// Government of Canada travel advisories.
//
// Primary source: the official open-data JSON feed (Global Affairs Canada, Open Government
// Licence - Canada): all destinations in one request. It's rebuilt about once a day, so the
// live advisory table on travel.gc.ca is also read: destinations updated since the feed was
// built take the table's level and date. Either source alone is enough if the other fails.
// Parsing and combining are in ./parse.mjs.

import { parseFeed, parseTable, combineSources } from './parse.mjs';

const FEED = 'https://data.international.gc.ca/travel-voyage/index-updated.json';
const PAGE = 'https://travel.gc.ca/travelling/advisories';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (travel-risk-map)' };
const MIN_DESTINATIONS = 150;   // ~230 in practice; far fewer means a format change

export default {
  id: 'ca',
  dataset: 'travel-advisories',
  source: FEED,

  /** `sleep` is injectable for tests. */
  async fetch({ log, previous, sleep = defaultSleep }) {
    const failures = [];
    const feed = await trySource('feed', async () => {
      const { generated, entries } = parseFeed(JSON.parse(await get(log, 'feed', FEED, sleep)));
      if (entries.length < MIN_DESTINATIONS) throw new Error(`only ${entries.length} destinations`);
      return { generated, entries };
    });
    const table = await trySource('table', async () => {
      const entries = parseTable(await get(log, 'table', PAGE, sleep));
      if (entries.length < MIN_DESTINATIONS) throw new Error(`only ${entries.length} destinations; page structure may have changed`);
      return entries;
    });
    if (!feed && !table) throw new Error(`Both sources failed. ${failures.join(' ')}`);
    failures.forEach(f => log.warn(f));

    const { entries, newerInTable } = combineSources(feed?.entries ?? [], table ?? []);

    // Destinations whose timestamp changed since the previous run (all of them on a first run).
    const before = new Map(previous.map(e => [e.name, e.stamp]));
    const changed = previous.length ? entries.filter(e => before.get(e.name) !== e.stamp).map(e => e.name) : `${entries.length} (first run)`;
    // Level changes since the previous run. Canada's levels are official fields, so they apply at once.
    const levelBefore = new Map(previous.map(e => [e.name, e.level]));
    const levelChanged = entries.filter(e => levelBefore.has(e.name) && levelBefore.get(e.name) !== e.level)
      .map(e => `${e.name} L${levelBefore.get(e.name)} → L${e.level}`);
    if (levelChanged.length) console.log(`Level changes: ${levelChanged.join('; ')}`);
    console.log(`${entries.length} destinations from ${[feed && 'feed', table && 'table'].filter(Boolean).join(' + ')}; `
      + `${newerInTable.length} newer on the website than the feed.`);

    return {
      entries,
      stats: {
        destinations: entries.length,
        sources: [feed && 'feed', table && 'table'].filter(Boolean),
        feedGenerated: feed?.generated ?? null,
        newerThanFeed: newerInTable,
        changed,
        levelChanged,
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

async function get(log, call, url, sleep, attempt = 1) {
  try {
    const res = await log.request(call, url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    if (res.challenge) throw new Error('Cloudflare challenge page instead of data');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.body;
  } catch (err) {
    if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
    await sleep(1500 * attempt);
    return get(log, call, url, sleep, attempt + 1);
  }
}

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
