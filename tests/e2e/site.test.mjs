// Browser tests: serve site/ locally, drive headless Chrome/Edge over it, and check the
// behaviour that caught real bugs in this project. Screenshots go to test-output/ (git-ignored).
//
// Needs `npm ci` (puppeteer-core) and a local Chrome or Edge; set CHROME_PATH to override.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, open, openRaw, anchorOf, isSelected, sleep, OUT, click, detailsTitle } from './helpers.mjs';

useBrowser();

const clearSelection = (page) => page.evaluate(() => document.getElementById('map').dispatchEvent(new MouseEvent('click', { bubbles: true })));

// Hover every country and dot; measure the details card each time.
const measureCards = (page) => page.evaluate(() => {
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

for (const source of ['us', 'ca']) {
  for (const [width, height] of [[1440, 860], [390, 844]]) {
    describe(`${source} at ${width}px`, () => {
      let page, stats;
      before(async () => {
        page = await open({ width, height, settings: { provider: source, recentDays: 90 } });
        stats = await measureCards(page);
        await page.screenshot({ path: `${OUT}${source}-${width}.png` });
      });
      after(async () => { await page?.close(); });

      test('renders countries coloured by advisory', () => {
        assert.ok(stats.shapes > 200, `${stats.shapes} shapes`);
        assert.ok(stats.colored > 200, `${stats.colored} coloured`);
      });
      test('lists every pulsing country in the recent feed', () => {
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

  test('the recent-update window filters the change feed', async () => {
    const page = await open({ settings: { provider: 'us', recentDays: 90 } });
    const count = () => page.evaluate(() => document.querySelectorAll('#recentList button').length);
    const wide = await count();
    await page.click('#recentSeg button[data-days="7"]');
    await sleep(200);
    assert.ok(await count() <= wide);
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
