// GDELT daily event files: news reports of protests and violence, counted per place and day,
// to spot unusual activity (never to set a level; see lib/anomaly.mjs).
//
// Source: data.gdeltproject.org (no key; free for any use with a citation and a link). One
// zip file per day, about 3.5 MB, published a few hours after the day ends (UTC). Each run
// counts the days since the last counted one, oldest first, at most `maxDaysPerRun`; the first
// run starts `backfillDays` ago. Yesterday's file not published yet is not an error: the next
// run gets it. An older day without a file is recorded as a gap.
//
// Military events between two countries (`pairs` in the config) are counted into a second
// store with its own days, so it can be backfilled on its own: each run reads the days either
// store still needs, once, and adds each day to the stores that lack it. Pairs with fewer than
// `pairs.minTotal` reports in their whole history are dropped, to keep the file small.

import { countEvents, fileDay } from './parse.mjs';
import { unzipFirst } from '../../lib/zip.mjs';
import { addDay, addDays, emptyCounts, prune } from '../../lib/counts.mjs';

const BASE = 'https://data.gdeltproject.org/events/';
const HEADERS = { 'User-Agent': 'travel-risk-map (github.com)' };

export default {
  id: 'gdelt',
  kind: 'counts',
  source: BASE,

  /**
   * @param previous       the stored counts, or null
   * @param previousPairs  the stored pair counts, or null (only with `config.pairs`)
   * @param sleep          injectable for tests
   * @returns { data, pairs (with config.pairs), stats }
   */
  async fetch({ log, previous, previousPairs = null, now, config, sleep = defaultSleep }) {
    let data = previous ?? emptyCounts();
    let pairs = config.pairs ? previousPairs ?? emptyCounts() : null;
    const yesterday = addDays(now.toISOString().slice(0, 10), -1);
    const start = addDays(yesterday, -config.backfillDays + 1);
    const nextOf = (d) => (d.last ? addDays(d.last, 1) : start);
    const pairOpts = { historyDays: config.pairs?.historyDays };
    let day = pairs && nextOf(pairs) < nextOf(data) ? nextOf(pairs) : nextOf(data);
    const counted = [];
    const gaps = [];
    let events = 0;
    const unmapped = {};
    for (let n = 0; n < config.maxDaysPerRun && day <= yesterday; n++, day = addDays(day, 1)) {
      const wantData = day >= nextOf(data);
      const wantPairs = pairs && day >= nextOf(pairs);
      const res = await get(log, `${BASE}${fileDay(day)}.export.CSV.zip`, sleep);
      if (res.status === 404) {
        if (day >= addDays(yesterday, -1)) break;   // not published yet
        if (wantData) data = addDay(data, day, null, config);
        if (wantPairs) pairs = addDay(pairs, day, null, pairOpts);
        gaps.push(day);
        continue;
      }
      const parsed = countEvents(unzipFirst(res.body).data.toString('utf8'), config);
      if (wantData) data = addDay(data, day, parsed.counts, config);
      if (wantPairs) pairs = addDay(pairs, day, parsed.pairs, pairOpts);
      counted.push(day);
      events += parsed.events;
      for (const [k, v] of Object.entries(parsed.unmapped)) unmapped[k] = (unmapped[k] ?? 0) + v;
    }
    const top = Object.entries(unmapped).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`);
    if (top.length) console.log(`Unmapped FIPS codes (most frequent): ${top.join(', ')}`);
    if (pairs) pairs = prune(pairs, config.pairs.minTotal);
    return {
      data, ...(pairs && { pairs }),
      stats: { counted, gaps, through: data.last, events, unmapped: top, ...(pairs && { pairsThrough: pairs.last, pairs: Object.keys(pairs.series).length }) },
    };
  },
};

// A 404 is an answer (no file for that day), not a failure.
async function get(log, url, sleep, attempt = 1) {
  try {
    const res = await log.request('daily', url, { headers: HEADERS, signal: AbortSignal.timeout(120000) }, { detail: false, binary: true });
    if (res.status === 404) return res;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (err) {
    if (attempt >= 3) throw new Error(`Daily file failed after ${attempt} attempts: ${err.message}`);
    await sleep(attempt * 30000);
    return get(log, url, sleep, attempt + 1);
  }
}

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
