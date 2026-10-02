// Storage for the data pipeline. Every read and write of configuration, snapshots, history
// and published data goes through this module, so the rest of the pipeline never touches
// file paths. To move to a database, implement the same methods against it and swap the
// store passed around (see docs/architecture.md for how the files map to tables).

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export class FileStore {
  constructor(root = ROOT) {
    this.root = root;
  }

  path(...parts) { return join(this.root, ...parts); }

  // ---- configuration (hand-edited, in config/)
  places() { return this.#readJson('config', 'places.json'); }
  dataset(id) { return this.#readJson('config', 'datasets', `${id}.json`); }
  provider(id) { return this.#readJson('config', 'providers', `${id}.json`); }
  datasetIds() { return this.#list('config/datasets', '.json'); }
  /** Risk categories and their shared scale. */
  categories() { return this.#readJson('config', 'categories.json'); }
  /** A risk source (not a travel-advisory provider), e.g. gdacs. */
  source(id) { return this.#readJson('config', 'sources', `${id}.json`); }
  sourceIds() { return this.#list('config/sources', '.json'); }
  /** When each provider and source is due: { id: { every: 'daily-slot' } | { everyMinutes } }. */
  schedule() { return this.#readJson('config', 'schedule.json'); }

  // ---- pipeline state (in data/)
  /** Latest fetched snapshot of one provider, or null if it has never been fetched. */
  snapshot(dataset, provider) { return this.#readJson('data', 'snapshots', dataset, `${provider}.json`, { optional: true }); }
  saveSnapshot(dataset, provider, snapshot) { this.#writeJson(snapshot, 'data', 'snapshots', dataset, `${provider}.json`); }

  /** Level history of a dataset: { provider: { recordTitle: [{ date, level }] } }. */
  history(dataset) { return this.#readJson('data', 'history', `${dataset}.json`, { optional: true }) ?? {}; }
  saveHistory(dataset, history) { this.#writeJson(history, 'data', 'history', `${dataset}.json`); }

  /** A risk source's current events: { source, fetchedAt, firstFetchedAt, events }, or null. */
  events(source) { return this.#readJson('data', 'events', `${source}.json`, { optional: true }); }
  saveEvents(source, data) { this.#writeJson(data, 'data', 'events', `${source}.json`); }
  /** Events that left the current file, one JSON line each, by the year they ended. */
  archiveEvents(source, events) {
    for (const e of events) this.#appendLine(e, 'data', 'archive', 'events', source, `${(e.toDate ?? e.startedAt).slice(0, 4)}.jsonl`);
  }

  /** A counts source's daily counts (lib/counts.mjs), or null. */
  counts(source) { return this.#readJson('data', 'counts', `${source}.json`, { optional: true }); }
  /** One line per place and series, so a new day changes each line instead of the whole file's layout. */
  saveCounts(source, data) {
    const file = this.path('data', 'counts', `${source}.json`);
    mkdirSync(dirname(file), { recursive: true });
    const places = Object.keys(data.series).sort();
    const series = places.map((p, i) => ` ${JSON.stringify(p)}: {${Object.keys(data.series[p]).sort()
      .map(n => `${JSON.stringify(n)}: ${JSON.stringify(data.series[p][n])}`).join(', ')}}${i < places.length - 1 ? ',' : ''}`);
    const head = `{"first": ${JSON.stringify(data.first)}, "last": ${JSON.stringify(data.last)}, "gaps": ${JSON.stringify(data.gaps)}, "series": {`;
    writeFileSync(file, `${head}\n${series.join('\n')}\n}}\n`);
  }

  /** A conflict source's stored versions (e.g. UCDP's "26.0.8"), oldest first. */
  conflictVersions(source) {
    return this.#list(`data/conflict/${source}`, '.json').sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));   // 24.0.9 before 24.0.10
  }
  /** Every stored version of a conflict source, oldest first: { fetchedAt (the latest's), versions }, or null. */
  conflict(source) {
    const versions = this.conflictVersions(source).map(v => this.#readJson('data', 'conflict', source, `${v}.json`));
    return versions.length ? { fetchedAt: versions.at(-1).fetchedAt, versions } : null;
  }
  /** One version, written once: one event per line, so the file reads (and diffs) by event. */
  saveConflictVersion(source, data) {
    const file = this.path('data', 'conflict', source, `${data.version}.json`);
    mkdirSync(dirname(file), { recursive: true });
    const { events, ...head } = data;
    const lines = (o) => Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
    const { countries, conflicts, ...meta } = head;
    writeFileSync(file, `{${Object.entries(meta).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')},\n`
      + `"countries": {\n${lines(countries)}\n},\n"conflicts": {\n${lines(conflicts)}\n},\n`
      + `"events": [\n${events.map(e => JSON.stringify(e)).join(',\n')}\n]}\n`);
  }

  /** Confirmed risk signals per place and category, with pending falls: see lib/risk.mjs. */
  signals() { return this.#readJson('data', 'signals', 'current.json', { optional: true }); }
  saveSignals(signals) { this.#writeJson(signals, 'data', 'signals', 'current.json'); }

  /** The risk change log of one year (append-only), oldest first. */
  changes(year) {
    const file = this.path('data', 'changes', `${year}.jsonl`);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  }
  appendChanges(changes) {
    for (const c of changes) this.#appendLine(c, 'data', 'changes', `${c.at.slice(0, 4)}.jsonl`);
  }

  /** Last attempt and success of every fetch: { id: { lastAttempt, lastSuccess, ... } }. */
  sourcesState() { return this.#readJson('data', 'sources-state.json', { optional: true }) ?? {}; }
  saveSourcesState(state) { this.#writeJson(state, 'data', 'sources-state.json'); }

  // ---- published site data (in site/, served as-is)
  geo() { return this.#readJson('site', 'data', 'geo', 'countries-50m.json'); }
  locales() { return this.#list('site/i18n', '.json'); }
  locale(code) { return this.#readJson('site', 'i18n', `${code}.json`); }
  publish(relPath, data) { this.#writeJson(data, 'site', 'data', ...relPath.split('/')); }
  published(relPath) { return this.#readJson('site', 'data', ...relPath.split('/'), { optional: true }); }

  // ---- helpers
  #readJson(...parts) {
    const opts = typeof parts.at(-1) === 'object' ? parts.pop() : {};
    const file = this.path(...parts);
    if (!existsSync(file)) {
      if (opts.optional) return null;
      throw new Error(`Missing ${file}`);
    }
    return JSON.parse(readFileSync(file, 'utf8'));
  }

  #writeJson(data, ...parts) {
    const file = this.path(...parts);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
  }

  #appendLine(data, ...parts) {
    const file = this.path(...parts);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(data) + '\n');
  }

  #list(dir, ext) {
    const full = this.path(...dir.split('/'));
    return existsSync(full) ? readdirSync(full).filter(f => f.endsWith(ext)).map(f => basename(f, ext)).sort() : [];
  }
}
