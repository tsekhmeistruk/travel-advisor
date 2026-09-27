// Browser tests of the map modes: Travel, Highest, Disasters and Changes. Real published risk
// data, plus changes of known ages from withRiskChanges() (real ones are rare, as for levels).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, open, openRaw, sleep, OUT, detailsTitle, withRiskChanges, measureCards, SETTINGS_KEY } from './helpers.mjs';

useBrowser();

const RISK_MODES = ['highest', 'disaster', 'changes'];
const saved = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SETTINGS_KEY);
const classOf = (page, id) => page.evaluate((placeId) => [...document.querySelectorAll('path.country')].find(e => e.__data__.key === placeId)?.getAttribute('class'), id);
const text = (page, id) => page.$eval(`#${id}`, el => el.textContent);
const checked = (page, sel) => page.$eval(`${sel} [aria-checked="true"]`, el => el.dataset.mode ?? el.dataset.days ?? el.dataset.dir);
const openMode = (mode, opts = {}) => openRaw({ ...opts, stored: { mode, risk: { recentDays: 90 }, ...(opts.stored ?? {}) } })
  .then(async (page) => { await page.waitForSelector('path.country'); return page; });

for (const mode of RISK_MODES) {
  for (const [width, height] of [[1440, 860], [390, 844]]) {
    describe(`${mode} mode at ${width}px`, () => {
      let page, stats;
      before(async () => {
        page = await openMode(mode, { width, height, intercept: withRiskChanges() });
        stats = await measureCards(page);
        await page.screenshot({ path: `${OUT}mode-${mode}-${width}.png` });
      });
      after(async () => { await page?.close(); });

      test('colours every country by its risk level', () => {
        assert.ok(stats.colored > 200, `${stats.colored} coloured`);
      });
      test('pulses the level changes and lists them in the feed', () => {
        assert.ok(stats.pulses >= (mode === 'disaster' ? 4 : 5), `${stats.pulses} pulses`);
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
      test('hides the provider switch and logs no console errors', async () => {
        assert.equal(await page.$eval('#providerSwitch', el => el.hidden), true);
        assert.deepEqual(page.errors, []);
      });
    });
  }
}

describe('mode switch', () => {
  test('switches modes in place: no reload, the map recolours, the choice is saved and put in the URL', async () => {
    const page = await open();
    await page.evaluate(() => { window.__stayed = true; });
    assert.equal(await checked(page, '#modeSwitch'), 'travel');
    assert.equal(await page.$eval('#providerSwitch', el => el.hidden), false);
    await page.click('#modeSwitch [data-mode="disaster"]');
    await page.waitForFunction(() => document.querySelector('#modeSwitch [aria-checked="true"]').dataset.mode === 'disaster');
    assert.equal(await page.evaluate(() => window.__stayed), true, 'no page reload');
    assert.match(await text(page, 'asOf'), /^Risk Monitor · updated/);
    assert.equal(await page.$eval('#providerSwitch', el => el.hidden), true);
    assert.match(await text(page, 'legend'), /Normal.*Elevated.*High.*Critical/);
    assert.equal((await saved(page)).mode, 'disaster');
    assert.equal(await page.evaluate(() => location.hash), '#mode=disaster');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await checked(page, '#modeSwitch'), 'disaster', 'remembered');
    await page.close();
  });

  test('keeps the selected place across modes, and puts it in the URL', async () => {
    const page = await openMode('highest', { intercept: withRiskChanges() });
    await page.click('#recentList button');
    await sleep(900);
    const title = await detailsTitle(page);
    assert.ok(title);
    assert.match(await page.evaluate(() => location.hash), /^#mode=highest&place=[a-z-]+$/);
    await page.click('#modeSwitch [data-mode="travel"]');
    await sleep(300);
    assert.equal(await detailsTitle(page), title, 'the same place, now with its advisory');
    await page.close();
  });

  test('a link with a mode and a place opens them, and a new hash switches mode', async () => {
    const page = await openRaw({ hash: '#mode=disaster&place=mx', stored: { mode: 'travel' } });
    await page.waitForSelector('path.country');
    await sleep(900);
    assert.equal(await checked(page, '#modeSwitch'), 'disaster', 'the URL wins over the saved mode');
    assert.equal(await detailsTitle(page), 'Mexico');
    await page.evaluate(() => { location.hash = '#mode=changes'; });
    await page.waitForFunction(() => document.querySelector('#modeSwitch [aria-checked="true"]').dataset.mode === 'changes');
    assert.match(await detailsTitle(page), /places? above Normal/, 'no place in the new hash: the overview');
    await page.close();
  });

  test('an unknown mode in the URL or settings falls back to Travel; old settings are migrated', async () => {
    const page = await openRaw({ hash: '#mode=nope', stored: { dataset: 'travel-advisories' } });
    await page.waitForSelector('path.country');
    assert.equal(await checked(page, '#modeSwitch'), 'travel');
    const s = await saved(page);
    assert.equal(s.mode, 'travel');
    assert.equal('dataset' in s, false, 'the old key is removed');
    await page.close();
  });
});

describe('risk panel', () => {
  test('the card lists every category with its level, and Mexico\'s disaster level names its GDACS alert', async () => {
    const page = await openMode('highest');
    await page.type('#search', 'mexico');
    await page.keyboard.press('Enter');
    await sleep(900);
    const rows = await page.$$eval('#details .risk-rows li', els => els.map(li => [li.querySelector('.cat').textContent, li.querySelector('.lvl').textContent, li.querySelector('.basis').textContent]));
    assert.deepEqual(rows.map(r => r[0]), ['Travel', 'Disaster', 'Wildfire']);
    for (const [, level] of rows) assert.match(level, /^(Normal|Elevated|High|Critical|No data)$/);
    assert.match(rows[0][2], /of 3 governments/);
    const disaster = rows[1];
    if (disaster[1] !== 'Normal') assert.match(disaster[2], /^GDACS (Orange|Red) /);
    assert.match(await text(page, 'footer'), /not official levels/);
    await page.close();
  });

  test('the window and direction filters change the feed and are saved', async () => {
    const page = await openMode('highest', { intercept: withRiskChanges() });
    const count = () => page.$$eval('#recentList button', els => els.length);
    const all = await count();
    await page.click('#riskDirectionSeg [data-dir="down"]');
    await sleep(200);
    const down = await count();
    assert.ok(down >= 1 && down < all, `${down} of ${all}`);
    assert.ok(await page.$$eval('#recentList .what .arrow', els => els.every(e => e.classList.contains('down'))));
    await page.click('#riskDirectionSeg [data-dir="all"]');
    await page.click('#riskWindowSeg [data-days="1"]');
    await sleep(200);
    assert.match(await text(page, 'recentTitle'), /24 hours/);
    assert.equal(await count(), 2, 'the 1-hour level change and the 2-hour event');
    assert.equal((await saved(page)).risk.recentDays, 1);
    await page.close();
  });

  test('hovering a feed item previews that place; clicking selects it', async () => {
    const page = await openMode('disaster', { intercept: withRiskChanges() });
    const first = await page.$('#recentList button');
    await first.hover();
    assert.equal(await detailsTitle(page), 'Japan');
    await first.click();
    await sleep(900);
    await page.hover('#footer');   // off the feed and the map: the selection shows
    assert.equal(await detailsTitle(page), 'Japan');
    assert.match(await page.$eval('#details', el => el.textContent), /Raised in the last 24 hours/);
    await page.close();
  });
});
