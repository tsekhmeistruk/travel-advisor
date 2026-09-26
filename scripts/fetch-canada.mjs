// Downloads Canada's travel advisories (travel.gc.ca) and saves them as
// data/sources/canada.json. Run scripts/build-data.mjs afterwards. Each run is logged to logs/fetch/.
// Parsing is in scripts/lib/canada.mjs.
//
// Usage: node scripts/fetch-canada.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withRunLog } from './lib/fetch-log.mjs';
import { parseTable, parseLatestUpdate, planPageReads } from './lib/canada.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'data', 'sources', 'canada.json');
const PAGE = 'https://travel.gc.ca/travelling/advisories';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (travel-risk-map)' };

await withRunLog('ca', async (log) => {
  const entries = parseTable(await get(log, 'table', PAGE));
  // The table has ~230 rows; far fewer means the page layout changed.
  if (entries.length < 150) throw new Error(`Parsed only ${entries.length} destinations; page structure may have changed.`);

  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).entries : [];
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

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), source: PAGE, entries }, null, 1) + '\n');
  console.log(`Saved ${entries.length} Canadian advisories; read ${toRead.length - failed.length} destination pages`
    + `${failed.length ? `, ${failed.length} failed` : ''}, reused ${entries.length - toRead.length} notes.`);

  log.stat({
    destinations: entries.length,
    // Destinations whose timestamp changed since the previous run (all of them on a first run).
    changed: previous.length ? toRead.map(e => e.name) : `${toRead.length} (first run)`,
    pagesRead: toRead.length - failed.length,
    pagesFailed: failed.length,
    notesReused: entries.length - toRead.length,
  });
});

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
