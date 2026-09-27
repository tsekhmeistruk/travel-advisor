// Fetches one provider's data and saves it as its latest snapshot. Run scripts/build.mjs
// afterwards. Each run is logged to logs/fetch/.
//
// Usage: node scripts/fetch.mjs <provider>      e.g. node scripts/fetch.mjs ca

import { withRunLog } from './lib/fetch-log.mjs';
import { FileStore } from './lib/store.mjs';
import { getProvider, PROVIDERS } from './providers/index.mjs';

if (!process.argv[2]) {
  console.error(`Usage: node scripts/fetch.mjs <provider>   (one of: ${Object.keys(PROVIDERS).join(', ')})`);
  process.exit(1);
}
const provider = getProvider(process.argv[2]);
const store = new FileStore();

await withRunLog(provider.id, async (log) => {
  const previous = store.snapshot(provider.dataset, provider.id)?.entries ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const { entries, stats } = await provider.fetch({ log, previous, today });
  store.saveSnapshot(provider.dataset, provider.id, { fetchedAt: new Date().toISOString(), source: provider.source, entries });
  log.stat(stats);
  console.log(`Saved ${entries.length} ${provider.id} entries.`);
});
