// Builds the published site data (site/data/*.json) from config/, the provider snapshots in
// data/snapshots/, the level history in data/history/ (which it updates), and the risk
// sources' events in data/events/ (updating data/signals/ and the change log in data/changes/).
// The logic is in scripts/lib/build.mjs and scripts/lib/risk.mjs; this script gathers inputs
// and writes outputs.
//
// Usage: node scripts/build.mjs   (run node scripts/fetch.mjs <id> first to refresh)

import { fileURLToPath } from 'node:url';
import { buildSite, placeIndex } from './lib/build.mjs';
import { buildRisk } from './lib/risk.mjs';
import { createStore } from './lib/store.mjs';
import { SPLIT_SHAPE_NAMES } from '../site/js/map/splits.js';

/** Everything buildAll() needs, read from the store. */
export function readBuildInput(store = createStore()) {
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
  const year = new Date().getUTCFullYear();
  return {
    places: store.places(), shapeNames, locales: store.locales(), datasets, history,
    risk: {
      categories: store.categories(),
      schedule: store.schedule(),
      sources: Object.fromEntries(store.sourceIds().map(id => {
        const config = store.source(id);
        const read = { counts: () => store.counts(id), conflict: () => store.conflict(id), context: () => store.context(id) }[config.kind] ?? (() => store.events(id));
        return [id, { config, data: read(), ...(config.pairs && { pairs: store.counts(`${id}-pairs`) }) }];
      })),
      state: store.signals(),
      log: [...store.changes(year - 1), ...store.changes(year)],
      sourcesState: store.sourcesState(),
    },
  };
}

/** The risk files the manifest points at: manifest key -> file name (risk/<name>.json). */
export const RISK_FILES = { current: 'current', changes: 'changes', events: 'events', health: 'health', conflict: 'conflict', conflictEvents: 'conflict-events', wars: 'wars' };

/**
 * The advisory files (buildSite) plus the risk layer (buildRisk), and the manifest entry that
 * points at the risk files. Pure: `history` in the input is mutated as buildSite documents.
 * @returns { files, problems, warnings, state, newChanges }
 */
export function buildAll(input) {
  const site = buildSite(input);
  const advisoryDataset = input.datasets.find(d => d.config.id === 'travel-advisories');
  const advisoryFiles = Object.fromEntries(Object.entries(site.files)
    .filter(([path]) => path.startsWith('travel-advisories/'))
    .map(([, data]) => [data.provider, data]));
  const risk = buildRisk({
    ...input.risk,
    index: placeIndex(input.places),
    advisories: {
      files: advisoryFiles,
      history: input.history[advisoryDataset?.config.id] ?? {},
      flags: Object.fromEntries((advisoryDataset?.providers ?? []).map(p => [p.config.id, p.config.flag])),
    },
  });
  const files = { ...site.files, ...JSON.parse(JSON.stringify(risk.files)) };
  files['manifest.json'] = {
    ...site.files['manifest.json'],
    risk: {
      asOf: risk.files['risk/current.json'].asOf,
      ...Object.fromEntries(Object.entries(RISK_FILES).filter(([, name]) => risk.files[`risk/${name}.json`]).map(([key, name]) => [key, `risk/${name}.json`])),
      places: 'risk/places/',   // + <placeId>.json, one per place
    },
  };
  return { files, problems: site.problems, warnings: risk.warnings, state: JSON.parse(JSON.stringify(risk.state)), newChanges: risk.newChanges };
}

// Run only when executed directly (tests import readBuildInput and buildAll).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const store = createStore();
  const input = readBuildInput(store);
  const { files, problems, warnings, state, newChanges } = buildAll(input);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  for (const w of warnings) console.warn(w);
  store.transaction(() => {
    store.publishAll(files);
    for (const [id, history] of Object.entries(input.history)) store.saveHistory(id, history);
    store.saveSignals(state);
    store.appendChanges(newChanges);
  });

  for (const d of files['manifest.json'].datasets) {
    for (const p of d.providers) {
      const recs = files[p.file].records;
      const counts = [1, 2, 3, 4].map(l => `L${l}: ${recs.filter(r => r.level === l).length}`).join(', ');
      console.log(`${d.id}/${p.id}: ${recs.length} records (${counts}), as of ${p.asOf}; `
        + `${recs.filter(r => r.levelChanges).length} with a recorded level change.`);
    }
  }
  const current = files['risk/current.json'];
  for (const [c, meta] of Object.entries(current.categories)) {
    const above = Object.values(current.places).filter(p => p[c]?.level > 1).length;
    console.log(`risk/${c}: ${above} places above Normal (sources: ${meta.sources.join(', ')}${meta.status ? `, ${meta.status}` : ''}).`);
  }
  console.log(`risk: ${files['risk/events.json'].events.length} active events, ${newChanges.length} new changes.`);
}
