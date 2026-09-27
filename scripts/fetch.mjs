// Fetches one provider's data and saves it as its latest snapshot. Run scripts/build.mjs
// afterwards. Each run is logged to logs/fetch/.
//
// Usage: node scripts/fetch.mjs <provider>      e.g. node scripts/fetch.mjs ca

import { fileURLToPath } from 'node:url';
import { withRunLog } from './lib/fetch-log.mjs';
import { FileStore } from './lib/store.mjs';
import { getProvider, PROVIDERS } from './providers/index.mjs';

/**
 * Fetch one provider into its snapshot, logging the run. Never throws: a failure is logged,
 * the previous snapshot is kept, and process.exitCode is set.
 * @param opts.store, opts.logRoot, opts.sleep  injectable for tests
 */
export async function runFetch(provider, { store = new FileStore(), logRoot, sleep, now = () => new Date() } = {}) {
  await withRunLog(provider.id, async (log) => {
    const previous = store.snapshot(provider.dataset, provider.id)?.entries ?? [];
    const today = now().toISOString().slice(0, 10);
    const { entries, stats } = await provider.fetch({ log, previous, today, ...(sleep && { sleep }) });
    store.saveSnapshot(provider.dataset, provider.id, { fetchedAt: now().toISOString(), source: provider.source, entries });
    log.stat(stats);
    console.log(`Saved ${entries.length} ${provider.id} entries.`);
  }, logRoot ? { root: logRoot } : {});
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv[2]) {
    console.error(`Usage: node scripts/fetch.mjs <provider>   (one of: ${Object.keys(PROVIDERS).join(', ')})`);
    process.exit(1);
  }
  await runFetch(getProvider(process.argv[2]));
}
