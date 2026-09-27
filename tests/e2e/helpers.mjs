// Shared setup for the browser tests: a local server for site/, one headless Chrome/Edge,
// and helpers to open the page with given saved settings and inspect the map.

import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve } from '../../scripts/serve.mjs';

export const SETTINGS_KEY = 'travel-risk-map:settings';
export const DATASET = 'travel-advisories';
export const OUT = fileURLToPath(new URL('../../test-output/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find(p => existsSync(p));

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Options from the environment (also as `npm run test:e2e --headed`):
//   HEADED=1                 show the browser window instead of running headless
//   SLOWMO=<ms>              pause between browser actions, to follow along (headed runs)
//   E2E_BASE_URL=<url>       test an already-running site (e.g. http://localhost:8080/)
//                            instead of starting a server on a free port
const HEADED = !!(process.env.HEADED || process.env.npm_config_headed);
const SLOWMO = Number(process.env.SLOWMO || process.env.npm_config_slowmo) || 0;
const BASE_URL = process.env.E2E_BASE_URL;

const env = {};
/** Register before/after hooks that start the server and browser for the calling test file. */
export function useBrowser() {
  before(async () => {
    assert.ok(executablePath, 'No Chrome/Edge found; set CHROME_PATH.');
    if (BASE_URL) env.url = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
    else ({ server: env.server, url: env.url } = await serve(0));
    env.browser = await puppeteer.launch({
      executablePath,
      headless: !HEADED,
      slowMo: SLOWMO,
      // Headless Chrome hides scrollbars by default; real Windows/Linux browsers show classic
      // ~15px scrollbars that take width from scrolling areas like the panel. Show them, so
      // layout tests see what those users see (this hid a real overflow bug once).
      ignoreDefaultArgs: ['--hide-scrollbars'],
      // Headed: open windows at the size the tests set, so what you see matches.
      defaultViewport: HEADED ? null : undefined,
      args: ['--no-sandbox', ...(HEADED ? ['--window-size=1460,960'] : [])],
    });
  });
  after(async () => { await env.browser?.close(); env.server?.close(); });
}

/**
 * Open the site with the given saved settings (raw, as stored) and collect errors.
 * @param opts.intercept  optional (request) => handled?; lets a test replace responses
 */
export async function openRaw({ width = 1440, height = 860, scheme = 'dark', stored = {}, intercept, hash = '' } = {}) {
  const page = await env.browser.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('requestfailed', r => page.errors.push(`request failed: ${r.url()}`));
  if (intercept) {
    await page.setRequestInterception(true);
    page.on('request', async (req) => { if (!(await intercept(req))) req.continue(); });
  }
  await page.setViewport({ width, height });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  await page.goto(env.url + hash);
  await page.evaluate((key, s) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(s)); }, SETTINGS_KEY, stored);
  await page.reload({ waitUntil: 'networkidle0' });
  return page;
}

/**
 * An `intercept` that serves a provider's real published file with level changes of known
 * ages added: 1, 3, 10 and 40 days ago, one per level (1–4). Real level changes are rare, so
 * tests of pulses and the change feed must not depend on the world having had one lately.
 * The oldest also gets the longest history the details card shows (three changes, one with
 * only a direction, as seeded from source notes).
 */
export function withLevelChanges(provider = 'us') {
  const file = `site/data/${DATASET}/${provider}.json`;
  const data = JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
  const day = (n) => {   // local date n days ago, as the site counts ages in local time
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const changed = [];
  [[1, 1], [2, 3], [3, 10], [4, 40]].forEach(([level, age]) => {
    const r = data.records.find(x => x.level === level && x.places.length === 1);
    const from = level === 1 ? 2 : level - 1;
    r.levelChanges = [{ date: day(age), from, to: level, up: level > from }];
    changed.push(r.title);
  });
  data.records.find(x => x.title === changed[3]).levelChanges.push(
    { date: day(200), from: 2, to: 3, up: true },
    { date: day(400), from: null, to: 2, up: false },
  );
  const body = JSON.stringify(data);
  const intercept = (req) => (isData(req, `${DATASET}/${provider}.json`)
    ? (req.respond({ status: 200, contentType: 'application/json', body }), true) : false);
  return Object.assign(intercept, { changed });
}

/** Whether a request is for a published data file (data files carry a ?v= version). */
export const isData = (req, path) => new URL(req.url()).pathname.endsWith(`/data/${path}`);

/**
 * An `intercept` for the risk modes, like withLevelChanges: serves the real risk change log
 * with changes of known ages added. Disaster level changes 1 hour, 3, 10 and 40 days ago (one
 * to each level, and one a fall), a wildfire level change 2 days ago, an advisory level change
 * 5 days ago, and a new GDACS event 2 hours ago. Also serves the real events plus three test
 * events with positions: two close together in Japan (one cluster at world zoom), one in
 * Chile, and two at the same point in Iceland (a cluster that never splits). Returns the places that changed, newest first, and the test events' ids.
 */
export function withRiskChanges() {
  const data = JSON.parse(readFileSync(new URL('../../site/data/risk/changes.json', import.meta.url), 'utf8'));
  const events = JSON.parse(readFileSync(new URL('../../site/data/risk/events.json', import.meta.url), 'utf8'));
  const ago = (hours) => new Date(Date.now() - hours * 36e5).toISOString();
  const level = (placeId, hours, from, to) => ({ id: `${placeId}:disaster:${ago(hours)}`, at: ago(hours), kind: 'level', category: 'disaster', placeId, from, to, up: to > from, basis: [], sources: ['gdacs'] });
  const added = [
    level('jp', 1, 1, 4),
    { id: 'test:event', at: ago(2), kind: 'event', category: 'disaster', source: 'gdacs', eventId: 'gdacs:EQ:0', type: 'earthquake', placeIds: ['cl'], to: 3, native: 'Orange', new: true },
    { ...level('au', 48, 1, 2), id: `au:wildfire:${ago(48)}`, category: 'wildfire' },
    level('ph', 72, 1, 3),
    { id: 'test:advisory', at: ago(120).slice(0, 10), kind: 'advisory', category: 'travel', source: 'us', title: 'Peru', placeIds: ['pe'], from: 1, to: 2, up: true },
    level('it', 240, 3, 2),
    level('tr', 960, 1, 2),
  ];
  const event = (id, lon, lat, placeIds, value, level, type) => ({
    id, source: 'gdacs', type, category: 'disaster', level, native: { scheme: 'gdacs-alert', value }, name: `Test ${type} ${id}`,
    severity: 'Magnitude 6.8M, Depth: 10km', placeIds, point: { lon, lat }, startedAt: ago(30), toDate: ago(2), current: true, url: 'https://www.gdacs.org/report.aspx?eventid=0',
  });
  const testEvents = [
    event('gdacs:EQ:0', -71, -33, ['cl'], 'Orange', 3, 'earthquake'),
    event('gdacs:TC:900', 139.7, 35.7, ['jp'], 'Red', 4, 'cyclone'),
    event('gdacs:FL:901', 140.6, 36.6, ['jp'], 'Green', 1, 'flood'),
    // Two at the very same point: a cluster that never splits.
    event('gdacs:VO:902', -19, 64.6, ['is'], 'Orange', 3, 'volcano'),
    event('gdacs:EQ:903', -19, 64.6, ['is'], 'Orange', 3, 'earthquake'),
  ];
  const bodies = {
    'risk/changes.json': JSON.stringify({ ...data, changes: [...added, ...data.changes] }),
    'risk/events.json': JSON.stringify({ ...events, events: [...testEvents, ...events.events] }),
  };
  const intercept = (req) => {
    const path = Object.keys(bodies).find(p => isData(req, p));
    return path ? (req.respond({ status: 200, contentType: 'application/json', body: bodies[path] }), true) : false;
  };
  return Object.assign(intercept, { places: ['jp', 'cl', 'au', 'ph', 'pe', 'it', 'tr'], events: testEvents.map(e => e.id) });
}

/** Hover every country and dot, measuring the details card each time, plus map and feed counts. */
export const measureCards = (page) => page.evaluate(() => {
  const card = document.getElementById('details');
  const heights = new Set(), overflow = [], cut = [];
  const measure = (label) => {
    heights.add(card.offsetHeight);
    const last = [...card.children].at(-1);
    if (card.scrollHeight > card.clientHeight + 1 || last.getBoundingClientRect().bottom > card.getBoundingClientRect().bottom - 8) overflow.push(label);
    // Also the "Last updated" value, the level history rows and the link: they may be shortened
    // with an ellipsis, but English must fit. (A risk row's basis may be shortened on purpose.)
    for (const el of card.querySelectorAll('h3, .badge, .meta dd, .history-list li, .link, .risk-rows .lvl, .trend')) if (el.scrollWidth > el.clientWidth + 1) cut.push(label);
  };
  measure('overview');
  for (const el of document.querySelectorAll('path.country, .dot')) {
    el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    measure(el.__data__.key);
    el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'touch' }));
  }
  return {
    shapes: document.querySelectorAll('path.country').length,
    colored: [...document.querySelectorAll('path.country')].filter(e => /\bl[1-4]\b/.test(e.getAttribute('class'))).length,
    pulses: document.querySelectorAll('.pulse').length,
    recent: document.querySelectorAll('#recentList button').length,
    heights: [...heights], overflow: [...new Set(overflow)], cut: [...new Set(cut)],
    scrollWidth: document.documentElement.scrollWidth,
  };
});

/** Open with travel-advisory settings, e.g. { provider: 'ca', recentDays: 90 }, and wait for the map. */
export async function open({ settings = {}, ...opts } = {}) {
  const page = await openRaw({ ...opts, stored: { [DATASET]: settings, ...(opts.stored ?? {}) } });
  await page.waitForSelector('path.country');
  return page;
}

export const url = () => env.url;

/** Screen position of a place's label point. */
export const anchorOf = (page, placeId) => page.evaluate((id) => {
  const el = [...document.querySelectorAll('path.country, .dot')].find(e => e.__data__.key === id);
  const r = document.getElementById('map').getBoundingClientRect();
  return { x: r.left + el.__data__.anchor[0], y: r.top + el.__data__.anchor[1] };
}, placeId);

export const isSelected = (page) => page.evaluate(() => {
  const s = document.querySelector('.select-outline');
  return s.getAttribute('display') !== 'none' && !!s.getAttribute('d');
});

export const detailsTitle = (page) => page.evaluate(() => document.querySelector('#details h3')?.textContent);

/** Press and release the mouse at a point, optionally moving a few px in between. */
export async function click(page, { x, y }, jitter = 0) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (jitter) await page.mouse.move(x + jitter, y + jitter / 2, { steps: 2 });
  await page.mouse.up();
  await sleep(150);
}
