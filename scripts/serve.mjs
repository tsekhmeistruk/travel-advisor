// Minimal static server for site/ (no dependencies). The app uses ES modules and fetches
// JSON, which browsers block on file:// pages, so open it through this server locally.
//
// Usage: node scripts/serve.mjs [port]     then open http://localhost:8080

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = resolve(fileURLToPath(new URL('../site/', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

/** Start the server; resolves to { server, url }. Port 0 picks a free port (used by tests). */
export function serve(port = 8080) {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = resolve(join(SITE, path));
      // Never serve anything outside site/ (e.g. /../config).
      if (file !== SITE && !file.startsWith(SITE + sep)) throw Object.assign(new Error('forbidden'), { code: 403 });
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (err) {
      res.writeHead(err.code === 403 ? 403 : 404, { 'Content-Type': 'text/plain' });
      res.end(err.code === 403 ? 'Forbidden' : 'Not found');
    }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => {
    resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { url } = await serve(Number(process.argv[2]) || 8080);
  console.log(`Serving site/ at ${url}  (Ctrl+C to stop)`);
}
