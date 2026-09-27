// Builds the published site data (site/data/*.json) from config/, the provider snapshots in
// data/snapshots/ and the level history in data/history/ (which it updates).
// The logic is in scripts/lib/build.mjs; this script gathers inputs and writes outputs.
//
// Usage: node scripts/build.mjs   (run node scripts/fetch.mjs <provider> first to refresh)

import { fileURLToPath } from 'node:url';
import { buildSite } from './lib/build.mjs';
import { FileStore } from './lib/store.mjs';
import { SPLIT_SHAPE_NAMES } from '../site/js/map/splits.js';

/** Everything buildSite() needs, read from the store. */
export function readBuildInput(store = new FileStore()) {
  const geo = store.geo();
  const shapeNames = new Set([...geo.objects.countries.geometries.map(g => g.properties.name), ...SPLIT_SHAPE_NAMES]);
  const datasets = store.datasetIds().map(id => {
    const config = store.dataset(id);
    return {
      config,
      providers: config.providers.map(pid => ({ config: store.provider(pid), snapshot: store.snapshot(id, pid) })),
    };
  });
  const history = Object.fromEntries(datasets.map(d => [d.config.id, store.history(d.config.id)]));
  return { places: store.places(), shapeNames, locales: store.locales(), datasets, history };
}

// Run only when executed directly (tests import readBuildInput).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const store = new FileStore();
  const input = readBuildInput(store);
  const { files, problems } = buildSite(input);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  for (const [path, data] of Object.entries(files)) store.publish(path, data);
  for (const [id, history] of Object.entries(input.history)) store.saveHistory(id, history);

  for (const d of files['manifest.json'].datasets) {
    for (const p of d.providers) {
      const recs = files[p.file].records;
      const counts = [1, 2, 3, 4].map(l => `L${l}: ${recs.filter(r => r.level === l).length}`).join(', ');
      console.log(`${d.id}/${p.id}: ${recs.length} records (${counts}), as of ${p.asOf}; `
        + `${recs.filter(r => r.levelChanges).length} with a recorded level change.`);
    }
  }
}
