// Browser checks for the Travel Risk Map. Drives headless Chrome/Edge over index.html
// and fails (exit 1) if any behaviour regressed. See SKILL.md for how to run it.
//
//   node <repo>/.claude/skills/verify-site/check.mjs [--out <screenshot dir>]
//
// puppeteer-core is resolved from the current working directory, so run this from a
// scratch folder where `npm i puppeteer-core` was done (keeps the repo dependency-free).

import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(pathToFileURL(join(process.cwd(), 'noop.js')).href);
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch {
  console.error('puppeteer-core not found in the current directory. Run `npm i puppeteer-core` here first.');
  process.exit(2);
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PAGE = pathToFileURL(join(repo, 'index.html')).href;
const outArg = process.argv.indexOf('--out');
const OUT = resolve(outArg > -1 ? process.argv[outArg + 1] : 'shots');
mkdirSync(OUT, { recursive: true });

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = BROWSERS.find(p => existsSync(p));
if (!executablePath) { console.error('No Chrome/Edge found; set CHROME_PATH.'); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath, headless: true });

async function open({ width = 1440, height = 860, scheme = 'dark', settings = {} } = {}) {
  const page = await browser.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.setViewport({ width, height });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  await page.goto(PAGE);
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('travel-risk-map:settings', JSON.stringify(s)); }, settings);
  await page.reload({ waitUntil: 'load' });
  return page;
}

// Screen position of a country's label point.
const anchorOf = (page, mapName) => page.evaluate((n) => {
  const el = [...document.querySelectorAll('path.country')].find(e => e.__data__.mapName === n);
  const r = document.getElementById('map').getBoundingClientRect();
  return { x: r.left + el.__data__.anchor[0], y: r.top + el.__data__.anchor[1] };
}, mapName);
const isSelected = (page) => page.evaluate(() => {
  const s = document.querySelector('.select-outline');
  return s.getAttribute('display') !== 'none' && !!s.getAttribute('d');
});
const clearSelection = (page) => page.evaluate(() => document.getElementById('map').dispatchEvent(new MouseEvent('click', { bubbles: true })));

try {
  // ---- 1. Both sources load, render and keep the details card a fixed size.
  for (const source of ['us', 'ca']) {
    for (const [w, h] of [[1440, 860], [390, 844]]) {
      const page = await open({ width: w, height: h, settings: { source, recentDays: 90 } });
      const stats = await page.evaluate(async () => {
        const card = document.getElementById('details');
        const heights = new Set(), overflow = [], cut = [];
        const measure = (label) => {
          heights.add(card.offsetHeight);
          const last = [...card.children].at(-1);
          if (card.scrollHeight > card.clientHeight + 1 || last.getBoundingClientRect().bottom > card.getBoundingClientRect().bottom - 8) overflow.push(label);
          for (const el of card.querySelectorAll('h3, .badge')) if (el.scrollWidth > el.clientWidth + 1) cut.push(label);
        };
        measure('overview');
        for (const el of document.querySelectorAll('path.country, .dot')) {
          el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
          measure(el.__data__.name);
          el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'touch' }));
        }
        return {
          shapes: document.querySelectorAll('path.country').length,
          colored: [...document.querySelectorAll('path.country')].filter(e => e.__data__.advisory).length,
          pulses: document.querySelectorAll('.pulse').length,
          recent: document.querySelectorAll('#recentList button').length,
          heights: [...heights], overflow: [...new Set(overflow)].slice(0, 5), cut: [...new Set(cut)].slice(0, 5),
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      const tag = `${source} ${w}px`;
      check(`${tag}: renders countries with advisories`, stats.shapes > 200 && stats.colored > 200, `${stats.colored}/${stats.shapes} colored`);
      check(`${tag}: recent list matches pulses`, stats.recent >= stats.pulses, `${stats.recent} listed, ${stats.pulses} pulses`);
      check(`${tag}: details card fixed height`, stats.heights.length === 1, `heights ${stats.heights.join(',')}`);
      check(`${tag}: details card content fits`, !stats.overflow.length && !stats.cut.length, [...stats.overflow, ...stats.cut].join(', '));
      check(`${tag}: no horizontal page scroll`, stats.scrollWidth <= w, `scrollWidth ${stats.scrollWidth}`);
      check(`${tag}: no console errors`, !page.errors.length, page.errors.join(' | '));
      await page.screenshot({ path: join(OUT, `${source}-${w}.png`) });
      await page.close();
    }
  }

  // ---- 2. Clicking selects despite small hand movement; dragging pans without selecting.
  {
    const page = await open();
    for (const jitter of [0, 3, 5]) {
      const { x, y } = await anchorOf(page, 'Brazil');
      await page.mouse.move(x, y); await page.mouse.down();
      if (jitter) await page.mouse.move(x + jitter, y + jitter / 2, { steps: 2 });
      await page.mouse.up(); await sleep(150);
      check(`click with ${jitter}px movement selects`, await isSelected(page));
      await clearSelection(page);
    }
    // Selection outline must sit above the hover outline, so it shows while hovering.
    const order = await page.evaluate(() => [...document.querySelector('.viewport').children].map(c => c.classList[0]));
    check('selection outline drawn above hover outline', order.indexOf('select-outline') > order.indexOf('hover-outline'));

    await page.click('#zoomIn'); await sleep(500);
    const before = await page.evaluate(() => document.querySelector('.viewport').getAttribute('transform'));
    await page.mouse.move(500, 400); await page.mouse.down(); await page.mouse.move(620, 440, { steps: 8 }); await page.mouse.up(); await sleep(200);
    const after = await page.evaluate(() => document.querySelector('.viewport').getAttribute('transform'));
    check('drag pans the map', before !== after);
    check('drag does not select', !(await isSelected(page)));
    await page.close();
  }

  // ---- 3. Source switch changes the data, labels and header, and persists.
  {
    const page = await open({ settings: { source: 'us' } });
    const label = () => page.evaluate(() => document.getElementById('asOf').textContent);
    const usHeader = await label();
    await page.click('#sourceToggle button[data-source="ca"]'); await sleep(400);
    const caHeader = await label();
    const chips = await page.evaluate(() => document.getElementById('levelChips').innerText);
    check('switch to Canada updates header', usHeader !== caHeader && /Canada/.test(caHeader), caHeader);
    check('switch to Canada updates level names', /Avoid all/.test(chips));
    await page.reload(); await sleep(300);
    const kept = await page.evaluate(() => document.querySelector('#sourceToggle [aria-checked="true"]')?.dataset.source);
    check('source choice persists after reload', kept === 'ca', kept);
    await page.screenshot({ path: join(OUT, 'ca-switch.png') });
    await page.close();
  }

  // ---- 4. Search finds a country and selects it.
  {
    const page = await open();
    await page.type('#search', 'japan'); await page.keyboard.press('Enter'); await sleep(900);
    const title = await page.evaluate(() => document.querySelector('#details h3')?.textContent);
    check('search selects the country', title === 'Japan' && await isSelected(page), title);
    await page.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
