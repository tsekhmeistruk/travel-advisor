// Dev tools: launch the local Chrome or Edge with puppeteer-core (as the browser tests do).
// CHROME_PATH overrides the search.

import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function findBrowser() {
  const path = process.env.CHROME_PATH ?? CANDIDATES.find(p => existsSync(p));
  if (!path) throw new Error('No Chrome/Edge found; set CHROME_PATH.');
  return path;
}

/** Headless browser with real (classic) scrollbars, like the browser tests. */
export function launch() {
  return puppeteer.launch({ executablePath: findBrowser(), headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
}

/**
 * Open a page in a fresh browser context (no settings shared between pages), collecting console
 * errors in page.errors. `stored` seeds the saved settings before any of the app's scripts run
 * (setting them after load doesn't work: the app writes its own copy back).
 */
export async function openPage(browser, url, { width = 1440, height = 860, scheme = 'light', touch = false, stored = null, settle = 800 } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.setViewport({ width, height, hasTouch: touch, isMobile: touch });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  if (stored) {
    await page.evaluateOnNewDocument((s) => {
      if (sessionStorage.getItem('seeded')) return;
      localStorage.setItem('travel-risk-map:settings', JSON.stringify(s));
      sessionStorage.setItem('seeded', '1');
    }, stored);
  }
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('path.country', { timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, settle));
  page.close = ((close) => async () => { await close.call(page); await context.close(); })(page.close);
  return page;
}

/** Screen position of a place's label point (to hover or click it). */
export const anchorOf = (page, placeId) => page.evaluate((id) => {
  const el = [...document.querySelectorAll('path.country, .dot')].find(e => e.__data__.key === id);
  const r = document.getElementById('map').getBoundingClientRect();
  return { x: r.left + el.__data__.anchor[0], y: r.top + el.__data__.anchor[1] };
}, placeId);
