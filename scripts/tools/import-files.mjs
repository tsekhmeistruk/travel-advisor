// Copies everything one store holds into another: the repo's files into a database
// (importFiles: the backend's seed, and a restore from the `data` branch) or a database into
// files (exportFiles: the backup, and refreshing the repo's copy). Both stores have the same
// methods, so it is one copy, in one transaction. Configuration is not copied: it is in git.
//
//   npm run data:import -- --db <file>     the repo's data/, logs/ and site/data/ into a new database
//   (DB_PATH names the file when --db is not given)

import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FileStore, ROOT } from '../lib/store.mjs';
import { SqliteStore } from '../lib/sqlite-store.mjs';

/**
 * Everything `from` holds into `to`. `to` must have no changes, archived events or fetch
 * runs: those are appended, so a second copy would double them.
 * @param config  the store whose configuration names the datasets, providers and sources
 *   (`from` itself, unless it is a folder with data alone, like a checkout of the `data` branch)
 * @returns the counts of what was copied
 */
export function copyStore({ from, to, config = from }) {
  const sources = config.sourceIds();
  if (to.changeYears().length || to.fetchRuns().length || sources.some(id => to.archivedEvents(id).length)) {
    throw new Error('The target already has changes, archived events or fetch runs: copy into an empty store');
  }
  const done = { snapshots: 0, histories: 0, sources: 0, changes: 0, archivedEvents: 0, fetchRuns: 0, published: 0 };
  to.transaction(() => {
    for (const dataset of config.datasetIds()) {
      for (const provider of config.dataset(dataset).providers) {
        const snapshot = from.snapshot(dataset, provider);
        if (snapshot && ++done.snapshots) to.saveSnapshot(dataset, provider, snapshot);
      }
      const history = from.history(dataset);
      if (Object.keys(history).length && ++done.histories) to.saveHistory(dataset, history);
    }
    for (const id of sources) {
      const source = config.source(id);
      const save = { counts: saveCounts, conflict: saveConflict, context: saveContext }[source.kind] ?? saveEvents;
      if (save({ from, to, id, source })) done.sources++;
      const archived = from.archivedEvents(id);
      to.archiveEvents(id, archived);
      done.archivedEvents += archived.length;
    }
    const signals = from.signals();
    if (signals) to.saveSignals(signals);
    for (const year of from.changeYears()) {
      const changes = from.changes(year);
      to.appendChanges(changes);
      done.changes += changes.length;
    }
    const sourcesState = from.sourcesState();
    if (Object.keys(sourcesState).length) to.saveSourcesState(sourcesState);
    for (const run of from.fetchRuns()) {
      to.appendFetchRun(run);
      done.fetchRuns++;
    }
    const paths = from.publishedPaths();
    to.publishAll(Object.fromEntries(paths.map(path => [path, from.published(path)])));
    done.published = paths.length;
  });
  return done;
}

function saveEvents({ from, to, id }) {
  const data = from.events(id);
  if (data) to.saveEvents(id, data);
  return !!data;
}

function saveCounts({ from, to, id, source }) {
  const data = from.counts(id);
  if (data) to.saveCounts(id, data);
  const pairs = source.pairs && from.counts(`${id}-pairs`);
  if (pairs) to.saveCounts(`${id}-pairs`, pairs);
  return !!data;
}

function saveConflict({ from, to, id }) {
  const versions = from.conflict(id)?.versions ?? [];
  for (const v of versions) to.saveConflictVersion(id, v);
  return versions.length > 0;
}

function saveContext({ from, to, id }) {
  const data = from.context(id);
  if (data) to.saveContext(id, data);
  return !!data;
}

/** The files of a repo (or of a checkout of the `data` branch) into a database. */
export const importFiles = ({ from = new FileStore(), to, config }) => copyStore({ from, to, config });
/** A database into the files a FileStore writes, in its usual formats. */
export const exportFiles = ({ from, to, config }) => copyStore({ from, to, config });

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({ options: { db: { type: 'string' }, from: { type: 'string' } } });
  const file = values.db ?? process.env.DB_PATH;
  if (!file) throw new Error('usage: import-files.mjs --db <file> [--from <folder>]   (or DB_PATH)');
  const to = new SqliteStore(file);
  const done = importFiles({ from: new FileStore(values.from ?? ROOT), to, config: new FileStore(ROOT) });
  to.close();
  console.log(`${file}: ${Object.entries(done).map(([k, n]) => `${n} ${k}`).join(', ')}.`);
}
