// UCDP Candidate Events: organized violence (wars, armed conflicts, attacks on civilians), one
// file per month, for the conflict category (lib/conflict.mjs).
//
// Source: ucdp.uu.se/downloads/candidateged/ (no key; CC BY 4.0, cite UCDP). UCDP's API needs a
// token; these files don't. A month's file (about 1.4 MB, 1,800 events) comes out in the
// following month or the one after. Each run asks for the versions after the last one stored,
// oldest first, at most `maxVersionsPerRun`; the first run starts at `backfillFrom`. A 404 means
// "not out yet", which is no error. A month that never came out (a 404 while the next one
// exists) is skipped. No month is asked for before it is over. A version stored in an older
// format (`outdated`) is downloaded again first, within the same per-run limit.

import { FORMAT, parseVersion, nextVersion, versionMonth, versionFile } from './parse.mjs';

const BASE = 'https://ucdp.uu.se/downloads/candidateged/';
const HEADERS = { 'User-Agent': 'travel-risk-map (github.com)' };

export default {
  id: 'ucdp',
  kind: 'conflict',
  source: BASE,
  format: FORMAT,

  /**
   * @param versions  the versions stored so far, oldest first
   * @param outdated  stored versions in an older format, to download again
   * @param sleep     injectable for tests
   * @returns { versions: [{ version, fetchedAt, format, countries, actors, conflicts, events }], stats }
   */
  async fetch({ log, versions, outdated = [], now, config, sleep = defaultSleep }) {
    const thisMonth = now.toISOString().slice(0, 7);
    const fetched = [];
    const skipped = [];
    const add = (version, res) => {
      const { malformed, ...parsed } = parseVersion(res.body);
      if (malformed) log.warn(`UCDP ${version}: ${malformed} malformed rows left out`);
      fetched.push({ version, month: versionMonth(version), fetchedAt: now.toISOString(), ...parsed });
    };
    const refetched = outdated.slice(0, config.maxVersionsPerRun);
    for (const old of refetched) {
      const res = await get(log, old, sleep);
      if (res.status === 404) throw new Error(`UCDP ${old} is stored in an older format and is no longer published`);
      add(old, res);
    }
    if (outdated.length > refetched.length) log.warn(`UCDP: ${outdated.length - refetched.length} version(s) still in an older format; the next run downloads them`);
    let v = versions.length ? nextVersion(versions.at(-1)) : config.backfillFrom;
    while (fetched.length < config.maxVersionsPerRun && versionMonth(v) < thisMonth) {
      let res = await get(log, v, sleep);
      if (res.status === 404) {
        const after = nextVersion(v);
        if (versionMonth(after) >= thisMonth) break;   // not out yet
        res = await get(log, after, sleep);
        if (res.status === 404) break;
        skipped.push(v);
        v = after;
      }
      add(v, res);
      v = nextVersion(v);
    }
    const unmapped = [...new Set(fetched.flatMap(f => Object.values(f.countries)))].filter(n => !(n in config.countries)).sort();
    if (unmapped.length) log.warn(`UCDP countries not in config/sources/ucdp.json: ${unmapped.join(', ')}`);
    if (skipped.length) log.warn(`UCDP versions that never came out: ${skipped.join(', ')}`);
    const fresh = fetched.slice(refetched.length);
    const through = fresh.at(-1)?.version ?? versions.at(-1) ?? null;
    return {
      versions: fetched,
      stats: { fetched: fresh.map(f => f.version), ...(refetched.length && { refetched }), skipped, through, events: fetched.reduce((n, f) => n + f.events.length, 0), unmapped },
    };
  },
};

// A 404 is an answer (that version isn't out), not a failure.
async function get(log, version, sleep, attempt = 1) {
  try {
    const res = await log.request('version', `${BASE}${versionFile(version)}`, { headers: HEADERS, signal: AbortSignal.timeout(120000) }, { detail: false });
    if (res.status === 404) return res;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (err) {
    if (attempt >= 3) throw new Error(`UCDP ${version} failed after ${attempt} attempts: ${err.message}`);
    await sleep(attempt * 30000);
    return get(log, version, sleep, attempt + 1);
  }
}

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
