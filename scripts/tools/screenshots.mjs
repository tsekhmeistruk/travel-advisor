// Screenshots of the site, to look at a change (layout problems don't always fail a test).
// Serves site/ on a free port (or uses --base, e.g. the live site), writes PNGs to
// test-output/shots/ (git-ignored), then stops the server.
//
//   npm run shots                          every mode at 1440 (light) and 390 (dark, full page)
//   npm run shots -- name=#mode=disaster   one view per name=hash (the hash may be empty: name=)
//   options: --base <url>  --out <dir>  --width 390  --height 844  --dark  --phone (touch)
//            --full (whole page)  --stored '{"mode":"travel"}' (saved settings)
//            --hover <placeId> | --click <placeId>  (after load)  --settle <ms>
//
// Then look at the files (the Read tool shows images).

import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { serve } from '../serve.mjs';
import { launch, openPage, anchorOf } from './browser.mjs';

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string' }, out: { type: 'string', default: 'test-output/shots/' },
    width: { type: 'string' }, height: { type: 'string' }, dark: { type: 'boolean' }, phone: { type: 'boolean' },
    full: { type: 'boolean' }, stored: { type: 'string' }, hover: { type: 'string' }, click: { type: 'string' }, settle: { type: 'string' },
  },
});

const MODES = ['wars', 'travel', 'highest', 'disaster', 'wildfire', 'changes'];
const views = positionals.length
  ? positionals.map(p => { const i = p.indexOf('='); return { name: i < 0 ? p : p.slice(0, i), hash: i < 0 ? '' : p.slice(i + 1) }; })
  : MODES.flatMap(m => [{ name: `${m}-1440`, hash: `#mode=${m}` }, { name: `${m}-390-dark`, hash: `#mode=${m}`, width: 390, height: 844, dark: true, phone: true, full: true }]);

const local = o.base ? null : await serve(0);
const base = (o.base ?? local.url).replace(/\/?$/, '/');
const out = o.out.replace(/\/?$/, '/');
mkdirSync(out, { recursive: true });
const browser = await launch();
let failed = false;
try {
  for (const v of views) {
    const phone = v.phone ?? o.phone;
    const page = await openPage(browser, `${base}?shot=${Date.now()}${v.hash}`, {
      width: Number(v.width ?? o.width ?? (phone ? 390 : 1440)), height: Number(v.height ?? o.height ?? (phone ? 844 : 860)),
      scheme: (v.dark ?? o.dark) ? 'dark' : 'light', touch: !!phone, stored: o.stored ? JSON.parse(o.stored) : null, settle: Number(o.settle ?? 800),
    });
    if (o.hover) { const a = await anchorOf(page, o.hover); await page.mouse.move(a.x, a.y); }
    if (o.click) { const a = await anchorOf(page, o.click); await page.mouse.click(a.x, a.y); await page.mouse.move(5, 5); }
    if (o.hover || o.click) await new Promise(r => setTimeout(r, 700));
    const file = `${out}${v.name}.png`;
    await page.screenshot({ path: file, fullPage: !!(v.full ?? o.full) });
    console.log(file, page.errors.length ? `console errors: ${page.errors.join(' | ')}` : '');
    failed ||= page.errors.length > 0;
    await page.close();
  }
} finally {
  await browser.close();
  local?.server.close();
}
process.exitCode = failed ? 1 : 0;
