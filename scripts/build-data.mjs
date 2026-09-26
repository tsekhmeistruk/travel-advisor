// Builds the site's data files from the source inputs:
//   data/sources/us.json        (U.S. State Department)  ┐
//   data/sources/canada.json    (Government of Canada)   ├-> data/advisories.js  (window.ADVISORY_DATA)
//   data/history.json           (level history, updated) ┘
//   data/countries-50m.json     -> data/world.js          (window.WORLD_TOPO)
// The logic is in scripts/lib/build.mjs; this script only reads and writes files.
//
// Usage: node scripts/build-data.mjs   (run scripts/fetch-us.mjs and fetch-canada.mjs first to refresh)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSources, mapNamesFrom, renderAdvisoriesJs, renderWorldJs } from './lib/build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PATHS = {
  sources: {
    us: join(root, 'data', 'sources', 'us.json'),
    ca: join(root, 'data', 'sources', 'canada.json'),
  },
  world: join(root, 'data', 'countries-50m.json'),
  history: join(root, 'data', 'history.json'),
  advisoriesJs: join(root, 'data', 'advisories.js'),
  worldJs: join(root, 'data', 'world.js'),
};

// Source snapshots as buildSources() expects them: { key: { asOf, advisories } }.
export function readRawSources() {
  const raw = {};
  for (const [key, file] of Object.entries(PATHS.sources)) {
    if (!existsSync(file)) { console.warn(`Missing ${file}; skipping ${key}. Run its fetch script first.`); continue; }
    const src = JSON.parse(readFileSync(file, 'utf8'));
    raw[key] = { asOf: src.fetchedAt.slice(0, 10), advisories: src.entries };
  }
  return raw;
}

// Run only when executed directly (tests import PATHS and readRawSources).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const topo = JSON.parse(readFileSync(PATHS.world, 'utf8'));
  const history = existsSync(PATHS.history) ? JSON.parse(readFileSync(PATHS.history, 'utf8')) : {};
  const raw = readRawSources();
  if (!raw.us) { console.error('U.S. data is required (run scripts/fetch-us.mjs).'); process.exit(1); }

  const { sources, problems } = buildSources(raw, history, mapNamesFrom(topo));
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }

  writeFileSync(PATHS.history, JSON.stringify(history, null, 1) + '\n');
  writeFileSync(PATHS.advisoriesJs, renderAdvisoriesJs(sources));
  writeFileSync(PATHS.worldJs, renderWorldJs(topo));

  for (const [key, s] of Object.entries(sources)) {
    const counts = [1, 2, 3, 4].map(l => `L${l}: ${s.advisories.filter(a => a.level === l).length}`).join(', ');
    const notes = s.advisories.filter(a => a.change).length;
    const minor = s.advisories.filter(a => a.minorUpdate).length;
    console.log(`${key}: ${s.advisories.length} advisories (${counts}), as of ${s.asOf}; ${notes} with change notes, ${minor} latest updates minor.`);
  }
}
