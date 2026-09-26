// Downloads Canada's travel advisories (travel.gc.ca) and saves them as
// data/sources/canada.json. Run scripts/build-data.mjs afterwards. Each run is logged to logs/fetch/.
//
// The advisory table gives each destination's level and "last updated" timestamp.
// What changed ("Latest updates") is only on each destination's own page, so those
// pages are read only when their timestamp differs from the previous snapshot;
// unchanged destinations keep the note already on file.
//
// Usage: node scripts/fetch-canada.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withRunLog } from './lib/fetch-log.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'data', 'sources', 'canada.json');
const PAGE = 'https://travel.gc.ca/travelling/advisories';
const SITE = 'https://travel.gc.ca';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (travel-risk-map)' };

// CSS class on each row's risk-level cell -> level 1..4.
const LEVEL_BY_CLASS = {
  'normal-precautions': 1,
  'increased-caution': 2,
  'reconsider-travel': 3,
  'do-not-travel': 4,
};

await withRunLog('ca', async (log) => {
  const html = await get(log, 'table', PAGE);

  // One <tr> per destination: hidden slug, link + name, risk-level div, timestamp.
  const ROW = /<tr>\s*<!-- 1\.[\s\S]*?<a href='([^']*)'>([^<]*)<\/a><\/td>[\s\S]*?<div class='([^']*)'>[\s\S]*?-->([^<]*)<!-- END[\s\S]*?<td[^>]*>([^<]*)<\/td>/g;

  const entries = [];
  for (const [, href, name, cls, text, stamp] of html.matchAll(ROW)) {
    const level = LEVEL_BY_CLASS[cls.trim()];
    if (!level) throw new Error(`Unknown risk class "${cls}" for ${name}`);
    entries.push({
      name: decode(name.trim()),
      level,
      regional: /regional advisories/i.test(text),
      updated: stamp.trim().slice(0, 10),
      stamp: stamp.trim(),
      url: SITE + href,
    });
  }

  // The table has ~230 rows; far fewer means the page layout changed.
  if (entries.length < 150) throw new Error(`Parsed only ${entries.length} destinations; page structure may have changed.`);

  // ---- What changed: reuse notes for unchanged timestamps, read the rest from destination pages.
  const previous = new Map();
  if (existsSync(OUT)) {
    for (const e of JSON.parse(readFileSync(OUT, 'utf8')).entries) previous.set(e.name, e);
  }
  const toRead = [];
  for (const e of entries) {
    const prev = previous.get(e.name);
    if (prev && prev.stamp === e.stamp && prev.change !== undefined) {
      e.change = prev.change;
    } else {
      toRead.push(e);
    }
  }

  const failed = [];
  await pool(toRead, 4, async (e) => {
    try {
      const page = await get(log, 'pages', e.url, { detail: false });
      const note = page.match(/id="lastUpdateTextLbl">([^<]*)</);
      if (!note) throw new Error('no "Latest updates" label');
      e.change = decode(note[1]).replace(/\s+/g, ' ').trim();
    } catch (err) {
      failed.push(e.name);
      console.warn(`  ${e.name}: could not read what changed (${err.message})`);
    }
  });
  if (failed.length) log.warn(`Could not read what changed for: ${failed.join(', ')}`);

  mkdirSync(dirname(OUT), { recursive: true });
  const out = { fetchedAt: new Date().toISOString(), source: PAGE, entries };
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`Saved ${entries.length} Canadian advisories; read ${toRead.length - failed.length} destination pages`
    + `${failed.length ? `, ${failed.length} failed` : ''}, reused ${entries.length - toRead.length} notes.`);

  log.stat({
    destinations: entries.length,
    // Destinations whose timestamp changed since the previous run (all of them on a first run).
    changed: previous.size ? toRead.map(e => e.name) : `${toRead.length} (first run)`,
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

function decode(s) {
  const named = { amp: '&', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', egrave: 'è', ccedil: 'ç' };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}
