// Storage for the data pipeline. Every read and write of configuration, snapshots, history
// and published data goes through this module, so the rest of the pipeline never touches
// file paths. To move to a database, implement the same methods against it and swap the
// store passed around (see docs/architecture.md for how the files map to tables).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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

  // ---- pipeline state (in data/)
  /** Latest fetched snapshot of one provider, or null if it has never been fetched. */
  snapshot(dataset, provider) { return this.#readJson('data', 'snapshots', dataset, `${provider}.json`, { optional: true }); }
  saveSnapshot(dataset, provider, snapshot) { this.#writeJson(snapshot, 'data', 'snapshots', dataset, `${provider}.json`); }

  /** Level history of a dataset: { provider: { recordTitle: [{ date, level }] } }. */
  history(dataset) { return this.#readJson('data', 'history', `${dataset}.json`, { optional: true }) ?? {}; }
  saveHistory(dataset, history) { this.#writeJson(history, 'data', 'history', `${dataset}.json`); }

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

  #list(dir, ext) {
    const full = this.path(...dir.split('/'));
    return existsSync(full) ? readdirSync(full).filter(f => f.endsWith(ext)).map(f => basename(f, ext)).sort() : [];
  }
}
