// Browser tests for the controls and interactions not covered by site.test.mjs: theme, panel,
// zoom buttons, tooltip, keyboard search, level filter, fading, feed hover, (de)selection,
// dots, load errors, languages (with a fake second locale) and accessible names.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useBrowser, open, openRaw, anchorOf, isSelected, sleep, click, detailsTitle, withLevelChanges } from './helpers.mjs';

useBrowser();

// A point on open ocean: the first grid point where the sphere (not a country or dot) is on top.
const oceanPoint = (page) => page.evaluate(() => {
  for (let y = 120; y < innerHeight - 120; y += 20) {
    for (let x = 60; x < innerWidth - 400; x += 20) {
      if (document.elementFromPoint(x, y)?.classList.contains('sphere')) return { x, y };
    }
  }
  return null;
});

const scaleOf = (page) => page.evaluate(() => {
  const t = document.querySelector('.viewport').getAttribute('transform') ?? '';
  return Number(t.match(/scale\(([\d.]+)/)?.[1] ?? 1);
});

describe('provider switch layout', () => {
  for (const [width, height] of [[1440, 860], [390, 844], [320, 640]]) {
    test(`at ${width}px it does not cover the zoom controls or leave the screen`, async () => {
      const page = await open({ width, height });
      const r = await page.evaluate(() => {
        const box = (id) => document.querySelector(id).getBoundingClientRect();
        const sw = box('#providerSwitch'), zoom = box('.map-controls');
        const overlap = sw.left < zoom.right && sw.right > zoom.left && sw.top < zoom.bottom && sw.bottom > zoom.top;
        return { overlap, inside: sw.left >= 0 && sw.right <= innerWidth, buttons: document.querySelectorAll('#providerSwitch button').length };
      });
      assert.ok(r.buttons >= 3, `${r.buttons} providers`);
      assert.equal(r.overlap, false, 'switch overlaps the zoom controls');
      assert.equal(r.inside, true, 'switch runs off the screen');
      await page.close();
    });
  }
});

describe('panel controls', () => {
  test('the theme button cycles auto → light → dark and is remembered', async () => {
    const page = await open();
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme ?? 'auto');
    assert.equal(await theme(), 'auto');
    await page.click('#themeToggle');
    assert.equal(await theme(), 'light');
    await page.click('#themeToggle');
    assert.equal(await theme(), 'dark');
    assert.match(await page.$eval('#themeToggle', b => b.getAttribute('aria-label')), /Theme: dark/);
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await theme(), 'dark');
    await page.close();
  });

  test('the panel collapses and reopens, and is remembered', async () => {
    const page = await open();
    await page.click('#panelClose');
    assert.equal(await page.$eval('#app', el => el.classList.contains('panel-collapsed')), true);
    assert.equal(await page.$eval('#panelOpen', el => el.hidden), false);
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#app', el => el.classList.contains('panel-collapsed')), true);
    await page.click('#panelOpen');
    assert.equal(await page.$eval('#app', el => el.classList.contains('panel-collapsed')), false);
    await page.close();
  });

  test('zoom buttons zoom in, out and back to the whole world', async () => {
    const page = await open();
    await page.click('#zoomIn'); await sleep(450);
    const zoomed = await scaleOf(page);
    assert.ok(zoomed > 1.5, `scale ${zoomed}`);
    await page.click('#zoomOut'); await sleep(450);
    assert.ok(await scaleOf(page) < zoomed);
    await page.click('#zoomIn'); await sleep(450);
    await page.click('#zoomReset'); await sleep(650);
    assert.equal(await scaleOf(page), 1);
    await page.close();
  });
});

describe('map interaction', () => {
  test('hovering with the mouse shows a tooltip with the place and level', async () => {
    const page = await open({ settings: { provider: 'us' } });
    const p = await anchorOf(page, 'br');
    await page.mouse.move(p.x, p.y);
    await sleep(150);
    const tip = await page.$eval('#tooltip', el => ({ hidden: el.hidden, text: el.innerText }));
    assert.equal(tip.hidden, false);
    assert.match(tip.text, /Brazil/);
    assert.match(tip.text, /Level \d · /);
    await page.mouse.move(5, 5);
    await sleep(150);
    assert.equal(await page.$eval('#tooltip', el => el.hidden), true);
    await page.close();
  });

  test('clicking a selected place again deselects it; clicking the ocean clears it', async () => {
    const page = await open();
    const brazil = await anchorOf(page, 'br');
    await click(page, brazil);
    assert.equal(await isSelected(page), true, 'first click selects');
    await sleep(400);   // not a double-click
    await click(page, brazil);
    assert.equal(await isSelected(page), false, 'second click deselects');
    await click(page, brazil);
    const ocean = await oceanPoint(page);
    assert.ok(ocean, 'found an ocean point');
    await click(page, ocean);
    assert.equal(await isSelected(page), false, 'clicking the ocean clears the selection');
    await page.close();
  });

  test('a tiny place can be selected through its dot', async () => {
    const page = await open({ settings: { provider: 'us' } });
    const id = await page.evaluate(() => document.querySelector('.dot')?.__data__.key);
    assert.ok(id, 'there are dots for tiny places');
    await click(page, await anchorOf(page, id));
    assert.equal(await page.evaluate((k) => document.querySelector(`.dot.is-selected`)?.__data__.key === k, id), true);
    await page.close();
  });

  test('hovering a feed item previews that place; clicking selects and zooms to it', async () => {
    const page = await open({ settings: { provider: 'us', recentDays: 90 }, intercept: withLevelChanges() });
    const first = await page.$('#recentList button');
    const name = await first.$eval('.name', el => el.textContent);
    await first.hover();
    await sleep(150);
    assert.equal(await detailsTitle(page), name);
    assert.equal(await page.$eval('#recentList button', b => b.classList.contains('is-active')), true);
    await first.click();
    await sleep(900);
    assert.equal(await isSelected(page), true);
    assert.ok(await scaleOf(page) > 1, 'zoomed to the place');
    await page.close();
  });
});

describe('settings', () => {
  test('hiding a level mutes those countries and removes them from the feed', async () => {
    const page = await open({ settings: { provider: 'us', recentDays: 90 }, intercept: withLevelChanges() });
    const feedLevels = () => page.$$eval('#recentList .swatch', els => els.map(e => e.getAttribute('style')));
    assert.ok((await feedLevels()).some(s => s.includes('--l2')), 'feed has level 2 items to begin with');
    await page.click('#levelChips [data-level="2"]');
    await sleep(150);
    assert.equal(await page.$eval('#levelChips [data-level="2"]', b => b.getAttribute('aria-pressed')), 'false');
    assert.ok(await page.$$eval('path.country.l2', els => els.length > 0 && els.every(e => e.classList.contains('is-muted'))));
    assert.ok(!(await feedLevels()).some(s => s.includes('--l2')));
    await page.close();
  });

  test('fading dims countries without a recent level change, and is disabled when highlighting is off', async () => {
    const changes = withLevelChanges();
    const page = await open({ settings: { provider: 'us', recentDays: 30 }, intercept: changes });
    await page.click('.switch');
    await sleep(150);
    assert.ok(await page.$$eval('path.country.is-dim', els => els.length) > 50);
    // The three changes within 30 days stay bright.
    assert.equal(await page.$$eval('#recentList button', els => els.length), 3);
    assert.ok(await page.$$eval('path.country:not(.is-dim)', els => els.filter(e => /\bl[1-4]\b/.test(e.getAttribute('class'))).length) >= 3);
    await page.click('#recentSeg [data-days="0"]');
    await sleep(150);
    assert.equal(await page.$$eval('path.country.is-dim', els => els.length), 0);
    assert.equal(await page.$eval('#dimToggle', el => el.closest('.setting').classList.contains('is-disabled')), true);
    await page.close();
  });
});

describe('search', () => {
  test('arrow keys move through results and Enter picks one; Escape closes', async () => {
    const page = await open();
    await page.type('#search', 'guinea');
    await sleep(100);
    const labels = await page.$$eval('#searchResults li', els => els.map(e => e.childNodes[2]?.textContent?.trim() ?? e.textContent));
    assert.ok(labels.length >= 2, labels.join());
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.$eval('#searchResults [aria-selected="true"]', el => el.dataset.i), '1');
    await page.keyboard.press('Escape');   // also clears a search input, as browsers do
    assert.equal(await page.$eval('#searchResults', el => el.hidden), true);
    await page.type('#search', 'guinea');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await sleep(900);
    assert.match(await detailsTitle(page), /Guinea/);
    assert.equal(await page.$eval('#search', el => el.value), '');
    await page.close();
  });

  test('a query with no matches says so', async () => {
    const page = await open();
    await page.type('#search', 'zzzz');
    assert.match(await page.$eval('#searchResults', el => el.innerText), /No matches/);
    await page.close();
  });
});

describe('robustness and accessibility', () => {
  test('shows a message instead of a blank page when the data cannot load', async () => {
    const page = await openRaw({
      intercept: (req) => (req.url().endsWith('/data/manifest.json') ? (req.respond({ status: 503, body: 'down' }), true) : false),
    });
    await sleep(300);
    assert.equal(await page.$eval('#loadError', el => el.hidden), false);
    await page.close();
  });

  test('every control has an accessible name', async () => {
    const page = await open();
    const unnamed = await page.$$eval('button, select:not([hidden]), input', els => els
      .filter(el => el.offsetParent !== null || el.id === 'dimToggle')
      .filter(el => !(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim() || el.closest('label')?.textContent.trim()))
      .map(el => el.outerHTML.slice(0, 80)));
    assert.deepEqual(unnamed, []);
    await page.close();
  });
});

describe('languages', () => {
  // A fake second locale served through request interception: Arabic, right-to-left, with
  // every English message prefixed so we can see it's in use. No real translation ships.
  const en = JSON.parse(readFileSync(new URL('../../site/i18n/en.json', import.meta.url), 'utf8'));
  const prefix = (v) => (typeof v === 'string' ? `[ar] ${v}` : Array.isArray(v) ? v : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, prefix(x)])));
  const ar = { ...prefix(en), meta: { name: 'العربية', dir: 'rtl' }, places: {} };
  const manifest = JSON.parse(readFileSync(new URL('../../site/data/manifest.json', import.meta.url), 'utf8'));
  const intercept = (req) => {
    if (req.url().endsWith('/data/manifest.json')) {
      req.respond({ contentType: 'application/json', body: JSON.stringify({ ...manifest, locales: ['ar', 'en'] }) });
      return true;
    }
    if (req.url().endsWith('/i18n/ar.json')) {
      req.respond({ contentType: 'application/json', body: JSON.stringify(ar) });
      return true;
    }
    return false;
  };

  test('with two locales the picker appears, and choosing one reloads the app in it', async () => {
    const page = await open({ intercept });
    assert.equal(await page.$eval('#language', el => el.hidden), false);
    assert.deepEqual(await page.$$eval('#language option', os => os.map(o => o.textContent)), ['العربية', 'English']);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.select('#language', 'ar')]);
    await page.waitForSelector('path.country');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ar');
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
    assert.match(await page.$eval('#filters h2', el => el.textContent), /^\[ar\] Filters/);
    assert.match(await page.$eval('#search', el => el.placeholder), /^\[ar\] /);
    // Country names come from the browser in the chosen language.
    await page.evaluate(() => [...document.querySelectorAll('path.country')].find(e => e.__data__.key === 'fr')
      .dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' })));
    const expected = await page.evaluate(() => new Intl.DisplayNames(['ar'], { type: 'region' }).of('FR'));
    assert.equal(await detailsTitle(page), expected);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('the browser language is used when nothing was chosen', async () => {
    const page = await openRaw({ intercept, stored: {} });
    await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'languages', { get: () => ['ar-EG', 'en'] }));
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'ar');
    await page.close();
  });
});
