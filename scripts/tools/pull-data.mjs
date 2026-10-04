// Downloads the backend's database (GET /admin/export: a consistent copy, gzipped) and writes
// it out as the files a FileStore keeps: data/, logs/fetch/ and site/data/. It refreshes the
// repo's copy (the seed and the tests' fixture), and the daily backup uses it on a checkout
// of the `data` branch.
//
//   npm run data:pull -- --base https://<backend> [--out <folder>]     (the token in ADMIN_TOKEN)

import { mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { FileStore, ROOT } from '../lib/store.mjs';
import { SqliteStore } from '../lib/sqlite-store.mjs';
import { exportFiles } from './import-files.mjs';

/** What an export replaces under `out`: the store's data, never the map's shapes (site/data/geo). */
export function clearData(out) {
  const keep = { data: [], 'logs/fetch': ['.gitkeep'], 'site/data': ['geo'] };
  for (const [dir, kept] of Object.entries(keep)) {
    const full = join(out, ...dir.split('/'));
    for (const name of existsSync(full) ? readdirSync(full) : []) {
      if (!kept.includes(name)) rmSync(join(full, name), { recursive: true, force: true });
    }
  }
}

/**
 * @param opts.base  the backend's address
 * @param opts.token  its ADMIN_TOKEN
 * @param opts.out  the folder to write (the repo by default); its data is replaced
 * @param opts.root  the repo whose configuration names the datasets and sources
 * @param opts.fetch  injectable for tests
 * @returns the counts of what was written
 */
export async function pullData({ base, token, out = ROOT, root = ROOT, fetch = globalThis.fetch }) {
  const url = new URL('admin/export', base.endsWith('/') ? base : `${base}/`);
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  const tmp = mkdtempSync(join(tmpdir(), 'trm-pull-'));
  let db;
  try {
    const file = join(tmp, 'risk.db');
    writeFileSync(file, gunzipSync(Buffer.from(await res.arrayBuffer())));
    db = new SqliteStore(file, { root });
    if (!db.publishedPaths().includes('manifest.json')) throw new Error('The export has no published data: nothing was written');
    clearData(out);
    return exportFiles({ from: db, to: new FileStore(out) });
  } finally {
    db?.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({ options: { base: { type: 'string' }, out: { type: 'string' } } });
  if (!values.base || !process.env.ADMIN_TOKEN) throw new Error('usage: pull-data.mjs --base <url> [--out <folder>]   (the token in ADMIN_TOKEN)');
  const out = values.out ?? ROOT;
  const done = await pullData({ base: values.base, token: process.env.ADMIN_TOKEN, out });
  console.log(`${out}: ${Object.entries(done).map(([k, n]) => `${n} ${k}`).join(', ')}.`);
}
