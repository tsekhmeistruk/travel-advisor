// Browser tests: serve site/ locally, drive headless Chrome/Edge over it, and check the
// behaviour that caught real bugs in this project. Screenshots go to test-output/ (git-ignored).
//
// Needs `npm ci` (puppeteer-core) and a local Chrome or Edge; set CHROME_PATH to override.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useBrowser, open, openRaw, anchorOf, isSelected, sleep, OUT, click, detailsTitle, withLevelChanges, measureCards } from './helpers.mjs';

useBrowser();

// Every provider in the published manifest, so new providers are tested automatically.
const PROVIDER_IDS = JSON.parse(readFileSync(new URL('../../site/data/manifest.json', import.meta.url), 'utf8'))
  .datasets.find(d => d.id === 'travel-advisories').providers.map(p => p.id);

const clearSelection = (page) => page.evaluate(() => document.getElementById('map').dispatchEvent(new MouseEvent('click', { bubbles: true })));

for (const source of PROVIDER_IDS) {
  for (const [width, height] of [[1440, 860], [390, 844]]) {
    describe(`${source} at ${width}px`, () => {
      // Real data plus level changes of known ages (real ones are rare): the fullest history
      // card and the pulses are then always part of the checks.
      let page, stats;
      before(async () => {
        page = await open({ width, height, settings: { provider: source, recentDays: 90 }, intercept: withLevelChanges(source) });
        stats = await measureCards(page);
        await page.screenshot({ path: `${OUT}${source}-${width}.png` });
      });
      after(async () => { await page?.close(); });

      test('renders countries coloured by advisory', () => {
        assert.ok(stats.shapes > 200, `${stats.shapes} shapes`);
        assert.ok(stats.colored > 200, `${stats.colored} coloured`);
      });
      test('pulses the level changes and lists every pulsing country in the feed', () => {
        assert.ok(stats.pulses >= 4, `${stats.pulses} pulses`);
        assert.ok(stats.recent >= stats.pulses, `${stats.recent} listed, ${stats.pulses} pulses`);
      });
      test('keeps the details card one fixed height for every country', () => {
        assert.equal(stats.heights.length, 1, `heights: ${stats.heights.join(', ')}`);
      });
      test('fits the details card content without overflow or cut-off', () => {
        assert.deepEqual([...stats.overflow, ...stats.cut], []);
      });
      test('has no horizontal page scroll', () => {
        assert.ok(stats.scrollWidth <= width, `scrollWidth ${stats.scrollWidth}`);
      });
      test('logs no console errors', () => {
        assert.deepEqual(page.errors, []);
      });
    });
  }
}

describe('map interaction', () => {
  let page;
  before(async () => { page = await open(); });
  after(async () => { await page?.close(); });

  for (const jitter of [0, 3, 5]) {
    test(`a click with ${jitter}px of movement selects the country`, async () => {
      await click(page, await anchorOf(page, 'br'), jitter);
      assert.equal(await isSelected(page), true);
      await clearSelection(page);
    });
  }

  test('draws the selection outline above the hover outline', async () => {
    const order = await page.evaluate(() => [...document.querySelector('.viewport').children].map(c => c.classList[0]));
    assert.ok(order.indexOf('select-outline') > order.indexOf('hover-outline'), order.join(' > '));
  });

  test('a drag pans the map and does not select', async () => {
    await page.click('#zoomIn');
    await sleep(500);
    const before = await page.evaluate(() => document.querySelector('.viewport').getAttribute('transform'));
    await page.mouse.move(500, 400);
    await page.mouse.down();
    await page.mouse.move(620, 440, { steps: 8 });
    await page.mouse.up();
    await sleep(200);
    const after = await page.evaluate(() => document.querySelector('.viewport').getAttribute('transform'));
    assert.notEqual(after, before);
    assert.equal(await isSelected(page), false);
  });
});

describe('panel', () => {
  test('the provider switch changes header and level names, and persists', async () => {
    const page = await open({ settings: { provider: 'us' } });
    const header = () => page.evaluate(() => document.getElementById('asOf').textContent);
    const usHeader = await header();
    await page.click('#providerSwitch button[data-provider="ca"]');
    await sleep(400);
    assert.notEqual(await header(), usHeader);
    assert.match(await header(), /Canada/);
    assert.match(await page.evaluate(() => document.getElementById('levelChips').innerText), /Avoid all/);
    await page.reload();
    await sleep(300);
    await page.waitForSelector('#providerSwitch [aria-checked="true"]');
    assert.equal(await page.evaluate(() => document.querySelector('#providerSwitch [aria-checked="true"]')?.dataset.provider), 'ca');
    await page.close();
  });

  test('search selects and shows the country', async () => {
    const page = await open();
    await page.type('#search', 'japan');
    await page.keyboard.press('Enter');
    await sleep(900);
    assert.equal(await detailsTitle(page), 'Japan');
    assert.equal(await isSelected(page), true);
    await page.close();
  });

  test('the window filters the level-change feed', async () => {
    const changes = withLevelChanges('us');
    const page = await open({ settings: { provider: 'us', recentDays: 90 }, intercept: changes });
    const names = () => page.$$eval('#recentList button', els => els.map(b => b.dataset.key));
    // Real changes may be listed too; the injected ones (1, 3, 10 and 40 days old) come in order.
    const ours = async () => (await names()).filter(n => changes.changed.includes(n));
    assert.deepEqual(await ours(), changes.changed, 'newest change first');
    assert.match(await page.$eval('#recentList .what', el => el.textContent), /^▼Level 2 → 1$/);
    await page.click('#recentSeg button[data-days="7"]');
    await sleep(200);
    assert.deepEqual(await ours(), changes.changed.slice(0, 2));
    await page.click('#recentSeg button[data-days="0"]');
    await sleep(200);
    assert.equal(await page.evaluate(() => document.querySelector('.recent').hidden), true, 'feed hidden when highlighting is off');
    await page.close();
  });

  test('search finds a place by a source\'s own name for it ("Burma")', async () => {
    const page = await open({ settings: { provider: 'us' } });
    await page.type('#search', 'burma');
    await page.keyboard.press('Enter');
    await sleep(900);
    assert.equal(await detailsTitle(page), 'Myanmar');
    await page.close();
  });

  test('search shows an advisory that has no place on the map (French West Indies)', async () => {
    const page = await open({ settings: { provider: 'us' } });
    await page.type('#search', 'french west');
    await page.keyboard.press('Enter');
    await sleep(300);
    const card = await page.evaluate(() => document.getElementById('details').innerText);
    assert.match(card, /French West Indies/);
    assert.match(card, /Guadeloupe/, 'shows the umbrella note');
    await page.close();
  });

  test('keeps settings saved by the previous version', async () => {
    const page = await openRaw({ stored: { source: 'ca', levels: [3, 4], recentDays: 7, dimOthers: true, theme: 'dark' } });
    assert.equal(await page.evaluate(() => document.querySelector('#providerSwitch [aria-checked="true"]')?.dataset.provider), 'ca');
    assert.equal(await page.evaluate(() => document.querySelector('#recentSeg [aria-checked="true"]')?.dataset.days), '7');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#levelChips [aria-pressed="true"]').length), 2);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await page.close();
  });

  test('hides the language picker while only one language exists', async () => {
    const page = await open();
    assert.equal(await page.evaluate(() => document.getElementById('language').hidden), true);
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    await page.close();
  });
});

describe('loading and keyboard', () => {
  test('a skeleton shows while the data loads, and is cleared once the map is drawn', async () => {
    let slow = false;
    const intercept = async (req) => {
      if (!slow || !/\/data\/geo\//.test(new URL(req.url()).pathname)) return false;
      await sleep(1500);
      return false;
    };
    const page = await openRaw({ intercept });
    await page.waitForSelector('path.country');
    assert.equal(await page.$eval('#app', el => el.hasAttribute('aria-busy')), false, 'cleared after load');
    slow = true;
    await page.evaluate(() => location.reload());
    await page.waitForSelector('#app[aria-busy="true"]');
    const skeleton = await page.evaluate(() => ({
      map: getComputedStyle(document.getElementById('mapArea'), '::before').content,
      card: getComputedStyle(document.getElementById('details'), '::before').content,
    }));
    assert.deepEqual(skeleton, { map: '""', card: '""' });
    await page.waitForFunction(() => !document.getElementById('app').hasAttribute('aria-busy'), { timeout: 10000 });
    assert.equal(await page.$$eval('path.country', els => els.length > 200), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('mapArea'), '::before').content), 'none');
    await page.close();
  });

  test('"/" focuses the search, but not while typing in a field', async () => {
    const page = await open();
    const focused = () => page.evaluate(() => document.activeElement?.id ?? null);
    await page.keyboard.press('/');
    assert.equal(await focused(), 'search');
    assert.equal(await page.$eval('#search', el => el.value), '', 'the key is not typed');
    await page.keyboard.type('a/b');
    assert.equal(await page.$eval('#search', el => el.value), 'a/b', 'typed as usual in the box');
    await page.close();
  });
});
