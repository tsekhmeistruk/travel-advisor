// One update, as the backend runs it: fetch what is due, build, check, publish. It is what
// the update workflow does in its steps, as one script on one store.
//
//   node scripts/update.mjs               fetch what is due (lib/schedule.mjs, the precise rules), then build
//   node scripts/update.mjs gdacs usgs    fetch these, due or not, then build ("all": every one)
//   node scripts/update.mjs --build       fetch nothing, build
//
// A failed fetch keeps its last data and the build goes on. A build with problems (a name it
// can't place) or that fails validatePublish() writes nothing: the last good data stays, the
// reason is kept in the store's meta ("lastBuild"), and the exit code is 1.
// Environment: DB_PATH (the store), SEED (the daily slot; "risk-monitor" by default, so the
// backend calls the U.S. API at another time than the workflow).

import { fileURLToPath } from 'node:url';
import { readBuildInput, buildAll, publishBuild } from './build.mjs';
import { runFetch } from './fetch.mjs';
import { dueSources } from './lib/schedule.mjs';
import { createStore } from './lib/store.mjs';
import { validatePublish } from './lib/validate.mjs';
import { PROVIDERS, SOURCES } from './providers/index.mjs';

export const SEED = 'risk-monitor';

/**
 * @param opts.store
 * @param opts.ids        the ids to fetch, due or not ("all": every scheduled one); none: what is due
 * @param opts.buildOnly  fetch nothing, build
 * @param opts.now        the clock
 * @param opts.seed       the daily slot's seed
 * @param opts.registry   { id: fetcher } (injectable for tests); the order is the order of the fetches:
 *                        the sources, then the advisory providers
 * @param opts.fetchOne   runFetch (injectable for tests)
 * @returns { fetched, failed, reasons, build: null | { at, ok, errors?, files?, changes? } }
 */
export async function runUpdate({
  store, ids = [], buildOnly = false, now = () => new Date(), seed = SEED,
  registry = { ...SOURCES, ...PROVIDERS }, fetchOne = runFetch, print = console.log,
} = {}) {
  let due = [];
  let reasons = {};
  if (!buildOnly) {
    const manual = ids.length > 0;
    const unknown = ids.filter(id => id !== 'all' && !registry[id]);
    if (unknown.length) throw new Error(`Unknown: ${unknown.join(', ')}. Known: ${Object.keys(registry).join(', ')}`);
    ({ due, reasons } = dueSources({ schedule: store.schedule(), state: store.sourcesState(), now: now(), seed, manual, only: ids.join(','), precise: true }));
    due = Object.keys(registry).filter(id => due.includes(id));
    for (const [id, why] of Object.entries(reasons)) print(`${due.includes(id) ? 'run ' : 'skip'} ${id}: ${why}`);
  }

  const failed = [];
  for (const id of due) {
    await fetchOne(registry[id], { store, now });
    const state = store.sourcesState()[id];
    if (!state || state.lastSuccess !== state.lastAttempt) failed.push(id);
  }

  const build = due.length || buildOnly ? buildAndPublish(store, { at: now().toISOString(), print }) : null;
  return { fetched: due, failed, reasons, build };
}

/** Build from the store and publish, or record why not. */
function buildAndPublish(store, { at, print }) {
  const input = readBuildInput(store);
  const built = buildAll(input);
  const errors = built.problems.length ? built.problems : validatePublish(built.files, (path) => store.published(path));
  let build;
  if (errors.length) {
    build = { at, ok: false, errors };
    print(`Not published:\n${errors.join('\n')}`);
  } else {
    for (const w of built.warnings) print(w);
    build = { at, ok: true, files: Object.keys(built.files).length, changes: built.newChanges.length };
  }
  // The files and the note about them, together: a reader never sees one without the other.
  store.transaction(() => {
    if (build.ok) publishBuild(store, input, built);
    store.saveMeta('lastBuild', build);
  });
  if (build.ok) print(`Published ${build.files} files, ${build.changes} new changes.`);
  return build;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const store = createStore();
  const result = await runUpdate({ store, ids: args.filter(a => !a.startsWith('--')), buildOnly: args.includes('--build'), seed: process.env.SEED ?? SEED });
  store.close();
  if (result.failed.length) console.error(`Failed: ${result.failed.join(', ')} (the last data is kept).`);
  if (!result.build) console.log('Nothing was due: no build.');
  // runFetch marks a failed fetch in the exit code; here only a build that wasn't published is a failure.
  process.exitCode = result.build && !result.build.ok ? 1 : 0;
}
