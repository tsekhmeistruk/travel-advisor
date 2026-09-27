// Browser tests of the map modes: Travel, Highest, Disasters and Changes. Real published risk
// data, plus changes of known ages from withRiskChanges() (real ones are rare, as for levels).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, open, openRaw, sleep, OUT, detailsTitle, withRiskChanges, measureCards, SETTINGS_KEY } from './helpers.mjs';

useBrowser();

const RISK_MODES = ['highest', 'disaster', 'wildfire', 'changes'];
// Pulses each mode must show with withRiskChanges(): its category's level changes, or all of them.
const MIN_PULSES = { highest: 6, disaster: 4, wildfire: 1, changes: 6 };
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
        assert.ok(stats.pulses >= MIN_PULSES[mode], `${stats.pulses} pulses`);
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

describe('event markers', () => {
  const markers = (page) => page.$$eval('.marker', els => els.map(e => ({ id: e.__data__.id, n: e.__data__.items.length, cls: e.getAttribute('class') })));

  test('the disaster mode draws its events; close ones form a cluster with a count', async () => {
    const page = await openMode('disaster', { intercept: withRiskChanges() });
    const list = await markers(page);
    assert.ok(list.some(m => m.id === 'gdacs:EQ:0' && m.n === 1), 'the Chile earthquake alone');
    const japan = list.find(m => m.id.includes('gdacs:TC:900'));
    assert.ok(japan && japan.n >= 2, 'the two Japan events clustered at world zoom');
    assert.match(japan.cls, /\bml4\b/, 'a cluster takes its highest level');
    assert.match(await text(page, 'legend'), /Alert/);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('hovering a marker shows its event; clicking selects it and its place', async () => {
    const page = await openMode('disaster', { intercept: withRiskChanges() });
    const el = await page.evaluateHandle(() => [...document.querySelectorAll('.marker')].find(e => e.__data__.id === 'gdacs:EQ:0'));
    await el.hover();
    assert.match(await detailsTitle(page), /Test earthquake/);
    assert.match(await page.$eval('#tooltip', t => t.textContent), /Orange alert · High · earthquake/);
    await el.click();
    await sleep(300);
    await page.hover('#footer');
    assert.match(await detailsTitle(page), /Test earthquake/);
    assert.match(await page.$eval('#details', d => d.textContent), /Affects\s*Chile/);
    assert.ok((await markers(page)).find(m => m.id === 'gdacs:EQ:0').cls.includes('is-selected'));
    assert.equal(await page.evaluate(() => location.hash), '#mode=disaster&place=cl');
    await page.close();
  });

  test('clicking a cluster zooms in until its events are apart', async () => {
    const page = await openMode('disaster', { intercept: withRiskChanges() });
    const zoom = () => page.evaluate(() => document.querySelector('.viewport').getAttribute('transform'));
    const before = await zoom();
    for (let i = 0; i < 4; i++) {
      const cluster = await page.evaluateHandle(() => [...document.querySelectorAll('.marker')].find(e => e.__data__.items.some(m => m.id === 'gdacs:TC:900')));
      if ((await cluster.evaluate(e => e.__data__.items.length)) === 1) break;
      await cluster.click();
      await sleep(700);
    }
    assert.notEqual(await zoom(), before);
    const list = await markers(page);
    assert.ok(list.some(m => m.id === 'gdacs:TC:900') && list.some(m => m.id === 'gdacs:FL:901'), 'split apart');
    await page.close();
  });

  test('a cluster that cannot split any more selects its first event at the closest zoom', async () => {
    const page = await openMode('disaster', { intercept: withRiskChanges() });
    for (let i = 0; i < 8 && !/Test (volcano|earthquake) gdacs:(VO:902|EQ:903)/.test(await detailsTitle(page) ?? ''); i++) {
      const cluster = await page.evaluateHandle(() => [...document.querySelectorAll('.marker')].find(e => e.__data__.items.some(m => m.id === 'gdacs:VO:902')));
      await cluster.click();
      await sleep(700);
      await page.hover('#footer');
    }
    assert.match(await detailsTitle(page), /Test earthquake gdacs:EQ:903/, 'the first of the two, by id');
    await page.close();
  });

  test('the highest mode shows only major alerts, the changes and travel modes none; hidden levels hide markers', async () => {
    const page = await openMode('highest', { intercept: withRiskChanges() });
    const ids = async () => (await markers(page)).flatMap(m => m.id.replace(/^cluster:/, '').split('|'));
    assert.ok((await ids()).includes('gdacs:TC:900'));
    assert.ok(!(await ids()).includes('gdacs:FL:901'), 'a Green alert is not major');
    await page.click('#riskLevelChips [data-level="4"]');
    await sleep(200);
    assert.ok(!(await ids()).includes('gdacs:TC:900'), 'Critical hidden');
    await page.click('#modeSwitch [data-mode="changes"]');
    await sleep(300);
    assert.equal((await markers(page)).length, 0);
    await page.click('#modeSwitch [data-mode="travel"]');
    await sleep(300);
    assert.equal((await markers(page)).length, 0);
    await page.close();
  });

  for (const width of [1440, 390]) {
    test(`at ${width}px every mode button shows its whole name`, async () => {
      const page = await open({ width, height: 844 });
      const cut = await page.$$eval('#modeSwitch button', els => els.filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent));
      assert.deepEqual(cut, []);
      assert.equal(await page.$$eval('#modeSwitch button', els => els.length), 5);
      await page.close();
    });
  }
});

describe('country view', () => {
  const view = (page) => page.evaluate(() => ({
    open: !document.getElementById('countryView').hidden,
    card: getComputedStyle(document.getElementById('details')).display !== 'none',
    settings: [...document.querySelectorAll('.panel .section')].some(s => getComputedStyle(s).display !== 'none'),
    name: document.querySelector('#countryView .cv-name')?.textContent ?? null,
    hash: location.hash,
  }));

  for (const [width, height] of [[1440, 860], [390, 844]]) {
    test(`at ${width}px opens from the card, replaces card, settings and feed, and goes back`, async () => {
      const page = await openMode('highest', { width, height, intercept: withRiskChanges() });
      await page.type('#search', 'japan');
      await page.keyboard.press('Enter');
      await sleep(900);
      await page.click('#details [data-action="country"]');
      await page.waitForSelector('#countryView .cv-name');
      assert.deepEqual(await view(page), { open: true, card: false, settings: false, name: 'Japan', hash: '#mode=highest&place=jp&view=country' });
      const text = await page.$eval('#countryView', el => el.innerText);
      assert.match(text, /Disaster: Normal → Critical/, 'its injected level change');
      assert.match(text, /Test cyclone gdacs:TC:900/, 'its injected alert');
      assert.match(text, /U\.S\.[\s\S]*Level \d · /, 'each government in its own words');
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(scroll <= width, `scrollWidth ${scroll}`);
      await page.screenshot({ path: `${OUT}country-view-${width}.png`, fullPage: width < 600 });
      await page.click('#countryView [data-action="back"]');
      assert.deepEqual(await view(page), { open: false, card: true, settings: true, name: null, hash: '#mode=highest&place=jp' });
      assert.deepEqual(page.errors, []);
      await page.close();
    });
  }

  test('opens from a link, follows another selected country, closes with Escape', async () => {
    const page = await openRaw({ hash: '#mode=disaster&place=mx&view=country', intercept: withRiskChanges() });
    await page.waitForSelector('#countryView .cv-name');
    assert.equal((await view(page)).name, 'Mexico');
    await page.type('#search', 'japan');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#countryView .cv-name')?.textContent === 'Japan');
    await page.keyboard.press('Escape');
    assert.equal((await view(page)).open, false);
    assert.equal((await view(page)).hash, '#mode=disaster&place=jp');
    await page.close();
  });

  test('the history window filters the changes; an alert opens its event card; Travel has no country view', async () => {
    const page = await openRaw({ hash: '#mode=highest&place=it&view=country', intercept: withRiskChanges() });
    await page.waitForSelector('#countryView .cv-name');
    const history = () => page.$$eval('#countryView .cv-history li', els => els.length);
    assert.equal(await history(), 1, 'the 10-day-old change, in the 90-day default');
    await page.click('#historySeg [data-history="7"]');
    assert.equal(await page.$$eval('#countryView .cv-history', els => els.length), 0);
    await page.close();

    const jp = await openRaw({ hash: '#mode=disaster&place=jp&view=country', intercept: withRiskChanges() });
    await jp.waitForSelector('#countryView [data-event]');
    await jp.click('#countryView [data-event="gdacs:TC:900"]');
    await sleep(900);
    assert.equal((await view(jp)).open, false);
    assert.match(await detailsTitle(jp), /Test cyclone gdacs:TC:900/);
    await jp.click('#modeSwitch [data-mode="travel"]');
    await sleep(300);
    assert.equal(await jp.$('#details [data-action="country"]'), null, 'the travel card has no country view');
    await jp.close();
  });
});
