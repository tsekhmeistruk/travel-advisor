// GDELT daily event files: news reports of protests and violence, counted per place and day,
// to spot unusual activity (never to set a level; see lib/anomaly.mjs).
//
// Source: data.gdeltproject.org (no key; free for any use with a citation and a link). One
// zip file per day, about 3.5 MB, published a few hours after the day ends (UTC). Each run
// counts the days since the last counted one, oldest first, at most `maxDaysPerRun`; the first
// run starts `backfillDays` ago. Yesterday's file not published yet is not an error: the next
// run gets it. An older day without a file is recorded as a gap.

import { countEvents, fileDay } from './parse.mjs';
import { unzipFirst } from '../../lib/zip.mjs';
import { addDay, addDays, emptyCounts } from '../../lib/counts.mjs';

const BASE = 'https://data.gdeltproject.org/events/';
const HEADERS = { 'User-Agent': 'travel-risk-map (github.com)' };

export default {
  id: 'gdelt',
  kind: 'counts',
  source: BASE,

  /** `sleep` is injectable for tests. */
  async fetch({ log, previous, now, config, sleep = defaultSleep }) {
    let data = previous ?? emptyCounts();
    const yesterday = addDays(now.toISOString().slice(0, 10), -1);
    let day = data.last ? addDays(data.last, 1) : addDays(yesterday, -config.backfillDays + 1);
    const counted = [];
    const gaps = [];
    let events = 0;
    const unmapped = {};
    for (let n = 0; n < config.maxDaysPerRun && day <= yesterday; n++, day = addDays(day, 1)) {
      const res = await get(log, `${BASE}${fileDay(day)}.export.CSV.zip`, sleep);
      if (res.status === 404) {
        if (day >= addDays(yesterday, -1)) break;   // not published yet
        data = addDay(data, day, null, config);
        gaps.push(day);
        continue;
      }
      const { counts, events: e, unmapped: u } = countEvents(unzipFirst(res.body).data.toString('utf8'), config);
      data = addDay(data, day, counts, config);
      counted.push(day);
      events += e;
      for (const [k, v] of Object.entries(u)) unmapped[k] = (unmapped[k] ?? 0) + v;
    }
    const top = Object.entries(unmapped).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`);
    if (top.length) console.log(`Unmapped FIPS codes (most frequent): ${top.join(', ')}`);
    return { data, stats: { counted, gaps, through: data.last, events, unmapped: top } };
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
