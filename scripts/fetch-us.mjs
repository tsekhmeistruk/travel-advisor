// Downloads U.S. State Department travel advisories from its public data API
// (the same data as travel.state.gov) and saves them as data/sources/us.json.
// Run scripts/build-data.mjs afterwards. Each run is logged to logs/fetch/.
//
// Why the API: the travel.state.gov page sits behind a bot check, and the RSS feed
// lags the page for some countries. The API matches the page's levels and dates.
//
// The API is inconsistent between calls: a response can leave out a few advisories, spell
// a name differently, or serve an outdated copy of an advisory. So each run is merged into
// the previous snapshot: names are matched to the ones already on file, an entry older than
// the saved one is ignored, and an advisory missing from a response is kept until it has
// been unseen for MISSING_GRACE_DAYS.
//
// Usage: node scripts/fetch-us.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withRunLog } from './lib/fetch-log.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'data', 'sources', 'us.json');
const MISSING_GRACE_DAYS = 7;
const API = 'https://cadataapi.state.gov/api/TravelAdvisories';
const RSS = 'https://travel.state.gov/_res/rss/TAsTWs.xml';
const HEADERS = { 'User-Agent': 'travel-risk-map (github.com)' };
// How the State Department opens a change note.
const CHANGE_NOTE = /^(reissued|updated|there (were|was|are|is) no changes?|the advisory level|advisory level|level \d)/i;

// Entries whose title isn't "<Country> - Level N: ...", keyed by the API's country code.
const NAME_BY_CODE = { MC: 'Macau', HK: 'Hong Kong', CH: 'China' };

await withRunLog('us', async (log) => {
  const today = new Date().toISOString().slice(0, 10);
  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).entries : [];
  const canonical = new Map(previous.map(e => [key(e.name), e.name]));

  const items = await fetchApi(log);

  const byName = new Map();
  let duplicates = 0;
  for (const item of items) {
    const m = decode(item.Title).match(/^(.+?)\s+-\s+Level\s+(\d)\b/);
    if (!m) throw new Error(`Unrecognised advisory title: ${item.Title}`);
    let name = m[1].replace(/\s+Travel Advisory$/i, '').trim();
    if (/ - See Summaries$|,.*&/.test(name)) name = NAME_BY_CODE[item.Category?.[0]] ?? name;
    name = canonical.get(key(name)) ?? name;   // e.g. "Cote d Ivoire" -> "Côte d’Ivoire"
    const entry = {
      name,
      lastSeen: today,
      level: Number(m[2]),
      // API times are U.S. Eastern evenings; the UTC date matches the "Date Updated" on travel.state.gov.
      updated: new Date(item.Updated || item.Published).toISOString().slice(0, 10),
      url: item.Link,
    };
    // The API lists a few advisories twice; keep the most recent copy.
    const prev = byName.get(name);
    if (prev) {
      duplicates++;
      if (prev.level !== entry.level) log.warn(`Duplicate "${name}" with different levels (${prev.level}, ${entry.level}); kept the newer.`);
    }
    if (!prev || entry.updated >= prev.updated) byName.set(name, entry);
  }

  if (byName.size < 150) throw new Error(`Parsed only ${byName.size} advisories; the API format may have changed.`);
  const fromApi = byName.size;

  // The API sometimes serves an outdated copy of an advisory (e.g. an old level from months
  // ago). Advisories only move forward in time, so an entry older than the one on file is
  // stale: keep the saved one.
  const stale = [];
  for (const prev of previous) {
    const cur = byName.get(prev.name);
    if (cur && cur.updated < prev.updated) {
      byName.set(prev.name, { ...prev, lastSeen: today });
      stale.push(`${prev.name} (got ${cur.updated} L${cur.level}, kept ${prev.updated} L${prev.level})`);
    }
  }
  if (stale.length) log.warn(`Ignored outdated API copies: ${stale.join('; ')}`);

  // Keep advisories this response left out, unless they've been gone too long.
  const carried = [];
  const dropped = [];
  for (const prev of previous) {
    if (byName.has(prev.name)) continue;
    const lastSeen = prev.lastSeen ?? today;
    if ((Date.parse(today) - Date.parse(lastSeen)) / 864e5 > MISSING_GRACE_DAYS) { dropped.push(prev.name); continue; }
    byName.set(prev.name, { ...prev, lastSeen });
    carried.push(prev.name);
  }
  if (carried.length) console.log(`Kept from previous snapshot (missing from this response): ${carried.join(', ')}`);
  if (dropped.length) log.warn(`Dropped after ${MISSING_GRACE_DAYS} days missing from the API: ${dropped.join(', ')}`);

  const entries = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  // What changed: the API rarely says, but the RSS feed usually opens each advisory with a
  // note such as "There were no changes to the advisory level…" or "Reissued after periodic
  // review…". The feed lags for some countries, so a note is used only when the feed's date
  // matches the API's (within a day, for the timezone offset). Optional: skipped if the feed fails.
  let notesMatched = null;
  try {
    const notes = await rssChangeNotes(log);
    notesMatched = 0;
    for (const e of entries) {
      const n = notes.get(key(e.name));
      if (n && Math.abs(Date.parse(n.date) - Date.parse(e.updated)) <= 864e5) { e.change = n.note; notesMatched++; }
    }
    console.log(`Change notes from RSS: ${notesMatched} of ${entries.length}.`);
  } catch (err) {
    log.warn(`RSS change notes unavailable (${err.message}); continued without them.`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  const out = { fetchedAt: new Date().toISOString(), source: API, entries };
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
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

async function rssChangeNotes(log) {
  const res = await log.request('rss', RSS, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (res.challenge) throw new Error('Cloudflare challenge page instead of data');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const tag = (s, t) => s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? '';
  const notes = new Map();
  for (const [, item] of res.body.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const name = decode(tag(item, 'title')).replace(/\s+-\s+Level\s+\d[\s\S]*$/, '').replace(/\s+Travel Advisory$/i, '');
    const desc = decode(tag(item, 'description').replace(/<!\[CDATA\[|\]\]>/g, ''));
    const first = (desc.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const note = first.replace(/^(Last Update|Reissued statement):\s*/i, '');
    if (!CHANGE_NOTE.test(note)) continue;    // first paragraph is the advisory text, not a change note
    notes.set(key(name), { date: new Date(`${tag(item, 'pubDate')} UTC`).toISOString().slice(0, 10), note });
  }
  return notes;
}

function key(name) { return name.normalize('NFD').replace(/[^a-z]/gi, '').toLowerCase(); }

function decode(s) {
  const named = { amp: '&', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}
