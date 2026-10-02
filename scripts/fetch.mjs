// Fetches one provider or risk source and saves its state. Run scripts/build.mjs afterwards.
// Each run is logged to logs/fetch/, and its outcome recorded in data/sources-state.json
// (which the update workflow's due check and the site's source health read).
//
//   travel-advisory providers (kind "advisories", the default): entries -> data/snapshots/
//   risk sources (kind "events", e.g. gdacs): events -> data/events/<id>.json; events that
//     expired are moved to data/archive/events/
//   counts sources (kind "counts", e.g. gdelt): daily counts -> data/counts/<id>.json (and pair counts
//     -> data/counts/<id>-pairs.json)
//   conflict sources (kind "conflict", e.g. ucdp): each new monthly version -> data/conflict/<id>/<version>.json
//
// Usage: node scripts/fetch.mjs <id>      e.g. node scripts/fetch.mjs ca

import { fileURLToPath } from 'node:url';
import { withRunLog } from './lib/fetch-log.mjs';
import { FileStore } from './lib/store.mjs';
import { getProvider, PROVIDERS, SOURCES } from './providers/index.mjs';

/**
 * Fetch one provider into its snapshot (or one source into its events), logging the run.
 * Never throws: a failure is logged, the previous state is kept, and process.exitCode is set.
 * @param opts.store, opts.logRoot, opts.sleep, opts.now  injectable for tests
 */
export async function runFetch(provider, { store = new FileStore(), logRoot, sleep, now = () => new Date() } = {}) {
  const started = now();
  let records = null;
  let error = null;
  await withRunLog(provider.id, async (log) => {
    try {
      const run = { events: fetchEvents, counts: fetchCounts, conflict: fetchConflict }[provider.kind] ?? fetchAdvisories;
      records = await run(provider, { store, log, sleep, now });
    } catch (err) {
      error = err;
      throw err;
    }
  }, logRoot ? { root: logRoot } : {});
  recordOutcome(store, provider.id, { started, finished: now(), records, error });
}

async function fetchAdvisories(provider, { store, log, sleep, now }) {
  const previous = store.snapshot(provider.dataset, provider.id)?.entries ?? [];
  const today = now().toISOString().slice(0, 10);
  const { entries, stats } = await provider.fetch({ log, previous, today, ...(sleep && { sleep }) });
  store.saveSnapshot(provider.dataset, provider.id, { fetchedAt: now().toISOString(), source: provider.source, entries });
  log.stat(stats);
  console.log(`Saved ${entries.length} ${provider.id} entries.`);
  return entries.length;
}

async function fetchEvents(provider, { store, log, sleep, now }) {
  const saved = store.events(provider.id);
  const at = now();
  const config = store.source(provider.id);
  const { events, expired = [], stats } = await provider.fetch({ log, previous: saved?.events ?? [], now: at, config, ...(sleep && { sleep }) });
  const fetchedAt = at.toISOString();
  store.saveEvents(provider.id, { source: provider.source, fetchedAt, firstFetchedAt: saved?.firstFetchedAt ?? fetchedAt, events });
  if (expired.length) store.archiveEvents(provider.id, expired);
  log.stat(stats);
  console.log(`Saved ${events.length} ${provider.id} events${expired.length ? `, archived ${expired.length}` : ''}.`);
  return events.length;
}

async function fetchCounts(provider, { store, log, sleep, now }) {
  const config = store.source(provider.id);
  const pairsId = `${provider.id}-pairs`;
  const { data, pairs, stats } = await provider.fetch({
    log, previous: store.counts(provider.id), ...(config.pairs && { previousPairs: store.counts(pairsId) }), now: now(), config, ...(sleep && { sleep }),
  });
  store.saveCounts(provider.id, data);
  if (pairs) store.saveCounts(pairsId, pairs);
  log.stat(stats);
  console.log(`Counted ${stats.counted.length} day(s) of ${provider.id}${stats.gaps.length ? `, ${stats.gaps.length} without a file` : ''}; counts through ${data.last}.`);
  return stats.counted.length;
}

async function fetchConflict(provider, { store, log, sleep, now }) {
  const config = store.source(provider.id);
  const stored = store.conflictVersions(provider.id);
  // Versions stored in an older format are downloaded again (the build refuses them).
  const outdated = provider.format ? (store.conflict(provider.id)?.versions ?? []).filter(v => v.format !== provider.format).map(v => v.version) : [];
  const { versions, stats } = await provider.fetch({ log, versions: stored, outdated, now: now(), config, ...(sleep && { sleep }) });
  for (const v of versions) store.saveConflictVersion(provider.id, v);
  log.stat(stats);
  if (stats.refetched?.length) console.log(`Downloaded ${provider.id} ${stats.refetched.join(', ')} again (a newer stored format).`);
  console.log(stats.fetched.length
    ? `Saved ${provider.id} ${stats.fetched.join(', ')} (${stats.events} events); data through ${stats.through}.`
    : `No new ${provider.id} version; data through ${stats.through}.`);
  return new Set([...stored, ...versions.map(v => v.version)]).size;
}

/** Update data/sources-state.json: every attempt, and the last success. */
export function recordOutcome(store, id, { started, finished, records, error }) {
  const state = store.sourcesState();
  const prev = state[id] ?? {};
  state[id] = {
    lastAttempt: started.toISOString(),
    lastSuccess: error ? prev.lastSuccess : started.toISOString(),
    durationMs: finished - started,
    records: error ? prev.records : records,
    consecutiveFailures: error ? (prev.consecutiveFailures ?? 0) + 1 : 0,
    ...(error && { error: error.message }),
  };
  store.saveSourcesState(Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b))));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv[2]) {
    console.error(`Usage: node scripts/fetch.mjs <id>   (one of: ${[...Object.keys(PROVIDERS), ...Object.keys(SOURCES)].join(', ')})`);
    process.exit(1);
  }
  await runFetch(getProvider(process.argv[2]));
}
