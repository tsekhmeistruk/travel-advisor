// Shared setup for the browser tests: a local server for site/, one headless Chrome/Edge,
// and helpers to open the page with given saved settings and inspect the map.

import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
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
export async function openRaw({ width = 1440, height = 860, scheme = 'dark', stored = {}, intercept } = {}) {
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
  await page.goto(env.url);
  await page.evaluate((key, s) => { localStorage.clear(); localStorage.setItem(key, JSON.stringify(s)); }, SETTINGS_KEY, stored);
  await page.reload({ waitUntil: 'networkidle0' });
  return page;
}

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
