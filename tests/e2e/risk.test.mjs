// Browser tests of the map modes: Travel, Highest, Disasters and Changes. Real published risk
// data, plus changes of known ages from withRiskChanges() (real ones are rare, as for levels).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useBrowser, open, openRaw, sleep, OUT, detailsTitle, withRiskChanges, measureCards, isData, SETTINGS_KEY } from './helpers.mjs';

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

      test('colours every country by its risk level (Normal in the calm risk fill)', () => {
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
    assert.match(await text(page, 'asOf'), /^Updated /);
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

  for (const [width, height] of [[1440, 860], [390, 844]]) {
    test(`at ${width}px the panel does not move between Travel and the risk modes`, async () => {
      // Fresh risk data, so the header is its usual one line (stale data adds a warning).
      const current = JSON.parse(readFileSync(new URL('../../site/data/risk/current.json', import.meta.url), 'utf8'));
      const body = JSON.stringify({ ...current, asOf: new Date().toISOString() });
      const fresh = (req) => isData(req, 'risk/current.json') && (req.respond({ status: 200, contentType: 'application/json', body }), true);
      // The UK has the longest agency name, which used to wrap the Travel header.
      const page = await open({ width, height, settings: { provider: 'uk' }, intercept: fresh });
      const top = () => page.$eval('#search', el => Math.round(el.getBoundingClientRect().top + scrollY));
      const travel = await top();
      await page.click('#modeSwitch [data-mode="highest"]');
      await page.waitForFunction(() => document.querySelector('#modeSwitch [aria-checked="true"]').dataset.mode === 'highest');
      assert.equal(await top(), travel);
      await page.close();
    });
  }

  test('a first visit opens on Highest; a saved Travel is kept', async () => {
    const first = await openRaw({ stored: {} });
    await first.waitForSelector('path.country');
    assert.equal(await checked(first, '#modeSwitch'), 'highest');
    assert.equal(await first.evaluate(() => document.title), 'Risk Monitor');
    await first.close();
    const back = await openRaw({ stored: { mode: 'travel' } });
    await back.waitForSelector('path.country');
    assert.equal(await checked(back, '#modeSwitch'), 'travel');
    await back.close();
  });

  test('an unknown mode in the URL falls back to the saved one; old settings are migrated to Travel', async () => {
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
    assert.deepEqual(rows.map(r => r[0]), ['Travel', 'Conflict', 'Disaster', 'Health'], 'wildfires are in the Disaster row');
    for (const [, level] of rows) assert.match(level, /^(Normal|Elevated|High|Critical|No data)$/);
    assert.match(rows[0][2], /^\d of \d governments?$/);
    assert.match(rows[1][2], /^([\d,]+ deaths?|None recorded) \(UCDP\)$/, 'what the conflict level is based on');
    const disaster = rows[2];
    if (disaster[1] !== 'Normal') assert.match(disaster[2], /^GDACS (Orange|Red) |^Lowering to /, 'the alert that set it, or a fall awaiting confirmation');
    assert.match(await text(page, 'footer'), /not official levels/);
    await page.close();
  });

  test('the conflict row reads its level from UCDP\'s deaths in 12 months (the published figures)', async () => {
    const page = await openMode('highest');
    const conflict = await page.evaluate(async () => (await fetch('data/risk/conflict.json')).json());
    const [placeId, figures] = Object.entries(conflict.places).sort((a, b) => b[1].deaths12 - a[1].deaths12)[0];
    const name = await page.evaluate(async (id) => (await (await fetch('data/places.json')).json()).find(p => p.id === id).name, placeId);
    await page.type('#search', name);
    await page.keyboard.press('Enter');
    await sleep(900);
    const row = await page.$$eval('#details .risk-rows li', els => els.map(li => [li.querySelector('.cat').textContent, li.querySelector('.lvl').textContent, li.querySelector('.basis').textContent, li.querySelector('.basis').title]).find(r => r[0] === 'Conflict'));
    const deaths = figures.deaths12.toLocaleString('en');
    assert.deepEqual(row, ['Conflict', 'Critical', `${deaths} deaths (UCDP)`, `${deaths} deaths in 12 months (UCDP)`], `${name}, the most deaths`);
    await page.close();
  });

  test('the window and direction filters change the feed and are saved', async () => {
    const page = await openMode('highest', { intercept: withRiskChanges() });
    const count = () => page.$eval('#recentCount', el => Number(el.textContent));
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
    // Real changes of the last day may be listed too: check the injected ones, not a total.
    const keys = await page.$$eval('#recentList button', els => els.map(b => b.dataset.key));
    assert.ok(keys.includes('test:event'), 'the 2-hour event');
    assert.ok(keys.some(k => k.startsWith('jp:disaster:')), 'the 1-hour level change');
    assert.ok(!keys.some(k => k.startsWith('it:disaster:')), 'not the 10-day-old one');
    assert.equal((await saved(page)).risk.recentDays, 1);
    await page.close();
  });

  test('the overview lists the latest changes; clicking one selects its place', async () => {
    const page = await openMode('highest', { intercept: withRiskChanges() });
    const names = await page.$$eval('#details .latest-list .name', els => els.map(e => e.textContent));
    assert.equal(names.length, 3);
    assert.equal(names[0], 'Japan', 'the injected 1-hour change is the newest');
    await page.click('#details .latest-list button');
    await sleep(900);
    await page.hover('#footer');
    assert.equal(await detailsTitle(page), 'Japan');
    assert.match(await page.evaluate(() => location.hash), /place=jp/);
    await page.close();
  });

  test('an empty window says so and offers 90 days', async () => {
    const none = (req) => isData(req, 'risk/changes.json') && (req.respond({ status: 200, contentType: 'application/json', body: '{"changes":[]}' }), true);
    const page = await openMode('changes', { stored: { mode: 'changes', risk: { recentDays: 7 } }, intercept: none });
    assert.match(await text(page, 'recentList'), /No changes in this period. Show 90 days/);
    assert.match(await text(page, 'details'), /Latest changes\s*No changes in this period\.\s*Show 90 days/);
    await page.click('#details [data-show-days="90"]');
    await sleep(200);
    assert.equal(await checked(page, '#riskWindowSeg'), '90');
    assert.equal((await saved(page)).risk.recentDays, 90);
    assert.equal(await page.$$eval('[data-show-days]', els => els.length), 0, 'nothing longer to offer');
    await page.close();
  });

  test('the filters are collapsed on a first visit, and stay as the visitor leaves them', async () => {
    const page = await openRaw({ stored: { filtersOpen: undefined } });
    await page.waitForSelector('path.country');
    const isOpen = () => page.$eval('#filters', el => el.open);
    assert.equal(await isOpen(), false);
    assert.equal(await page.$eval('#riskLevelChips', el => el.checkVisibility()), false, 'hidden while collapsed');
    await page.click('#filters summary');
    assert.equal(await isOpen(), true);
    await sleep(100);   // the toggle event comes after the click
    assert.equal((await saved(page)).filtersOpen, true);
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await isOpen(), true, 'remembered');
    await page.close();
  });

  test('"How levels work" opens from the legend and closes with Escape or the backdrop', async () => {
    const page = await openMode('highest');
    const isOpen = () => page.$eval('#help', el => el.open);
    await page.click('#legend [data-action="help"]');
    assert.equal(await isOpen(), true);
    assert.match(await text(page, 'help'), /How levels work[\s\S]*Critical[\s\S]*never sets a level/);
    await page.keyboard.press('Escape');
    assert.equal(await isOpen(), false);
    await page.click('#legend [data-action="help"]');
    await page.mouse.click(8, 8);   // the backdrop
    assert.equal(await isOpen(), false);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('data more than 12 hours old is flagged in the header', async () => {
    const current = JSON.parse(readFileSync(new URL('../../site/data/risk/current.json', import.meta.url), 'utf8'));
    const body = JSON.stringify({ ...current, asOf: new Date(Date.now() - 30 * 36e5).toISOString() });
    const old = (req) => isData(req, 'risk/current.json') && (req.respond({ status: 200, contentType: 'application/json', body }), true);
    const page = await openMode('highest', { intercept: old });
    assert.match(await text(page, 'asOf'), /^Updated (a day|1 day|yesterday)[^:]*: newer data is delayed/);
    assert.equal(await page.$eval('#asOf', el => el.classList.contains('is-stale')), true);
    await page.close();
  });

  test('a long feed shows its first 8 changes, then all of them', async () => {
    const page = await openMode('highest', { intercept: withRiskChanges() });
    const total = await page.$eval('#recentCount', el => Number(el.textContent));
    assert.ok(total > 8, `${total} changes`);
    const items = () => page.$$eval('#recentList button[data-key]', els => els.length);
    assert.equal(await items(), 8);
    await page.click('#recentList [data-feed-all]');
    assert.equal(await items(), Math.min(total, 50));
    assert.equal(await page.$$eval('#recentList [data-feed-all]', els => els.length), 0);
    await page.close();
  });

  test('news activity has its own section, not the feed; a row selects its place; none in Disasters or Travel', async () => {
    const page = await openMode('highest', { intercept: withRiskChanges() });
    const keys = await page.$$eval('#recentList button[data-key]', els => els.map(b => b.dataset.key));
    assert.ok(keys.includes('test:event') && !keys.includes('test:news'), 'the 3-hour-old anomaly is not listed between the newer changes');
    assert.equal(await page.$eval('#recentList', el => /GDELT/.test(el.textContent)), false, 'no news item in the feed');
    assert.equal(await page.$eval('#newsSection', el => el.checkVisibility()), true);
    const first = await page.$eval('#newsList button[data-place]', b => ({ place: b.dataset.place, text: b.textContent.replace(/\s+/g, ' ').trim() }));
    assert.deepEqual(first, { place: 'nz', text: 'New Zealand Protest reports far above normal' }, 'the most unusual first');
    await page.click('#newsList button[data-place="nz"]');
    await sleep(900);
    await page.hover('#footer');
    assert.equal(await detailsTitle(page), 'New Zealand');
    assert.match(await page.evaluate(() => location.hash), /place=nz/);
    assert.match(await page.$eval('#details', el => el.textContent), /News: Protest reports far above normal \(GDELT\)/);
    const mode = (id) => page.waitForFunction((m) => document.querySelector('#modeSwitch [aria-checked="true"]').dataset.mode === m, {}, id);
    await page.click('#modeSwitch [data-mode="disaster"]');
    await mode('disaster');
    assert.equal(await page.$eval('#newsSection', el => el.checkVisibility()), false, 'a category mode');
    await page.click('#modeSwitch [data-mode="travel"]');
    await mode('travel');
    assert.equal(await page.$eval('#newsSection', el => el.checkVisibility()), false, 'Travel');
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('the search finds an alert by name: Enter shows its card, selects its marker and zooms to it', async () => {
    const page = await openMode('highest', { intercept: withRiskChanges() });
    assert.equal(await page.$eval('#search', el => el.placeholder), 'Find a country or alert');
    await page.type('#search', 'test cyclone');
    await page.waitForSelector('#searchResults li[data-i]');
    assert.match(await page.$eval('#searchResults li[data-i]', el => el.textContent), /Test cyclone gdacs:TC:900\s*Red alert · tropical cyclone/);
    await page.keyboard.press('Enter');
    await sleep(1000);
    await page.hover('#footer');
    assert.equal(await detailsTitle(page), 'Test cyclone gdacs:TC:900');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.marker.is-selected')].some(m => m.__data__.items.some(i => i.id === 'gdacs:TC:900'))), true, 'its marker is selected');
    assert.ok(await page.evaluate(() => Number(document.querySelector('.viewport').getAttribute('transform').match(/scale\(([\d.]+)/)[1])) >= 3, 'zoomed to the marker');
    await page.click('#modeSwitch [data-mode="travel"]');
    await page.waitForFunction(() => document.querySelector('#modeSwitch [aria-checked="true"]').dataset.mode === 'travel');
    assert.equal(await page.$eval('#search', el => el.placeholder), 'Find a country', 'Travel finds places only');
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
    test(`at ${width}px every mode button shows its whole name, on the map`, async () => {
      const page = await open({ width, height: 844 });
      assert.equal(await page.$eval('#modeSwitch', el => !!el.closest('#mapArea')), true);
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

  test('Share copies the link to the country view, and says so', async () => {
    const page = await openRaw({ hash: '#mode=highest&place=jp&view=country' });
    await page.waitForSelector('#countryView .cv-name');
    const at = new URL(page.url());
    await page.browserContext().overridePermissions(at.origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
    await page.click('#countryView [data-action="share"]');
    await page.waitForSelector('#toast:not([hidden])');
    assert.equal(await page.$eval('#toast', el => el.textContent), 'Link copied');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${at.origin}${at.pathname}#mode=highest&place=jp&view=country`);
    await page.waitForSelector('#toast[hidden]', { timeout: 4000 });   // and goes away
    assert.deepEqual(page.errors, []);
    await page.close();
  });

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

  test('the history window filters the changes; an alert opens its event card; Travel opens it too', async () => {
    const page = await openRaw({ hash: '#mode=highest&place=it&view=country', intercept: withRiskChanges() });
    await page.waitForSelector('#countryView .cv-name');
    // The injected 10-day-old fall (High → Elevated); real changes may be listed too.
    const injected = () => page.$$eval('#countryView .cv-history li', els => els.filter(li => /Disaster: High → Elevated/.test(li.textContent)).length);
    assert.equal(await injected(), 1, 'in the 90-day default');
    await page.click('#historySeg [data-history="7"]');
    assert.equal(await injected(), 0, 'outside 7 days');
    await page.close();

    const jp = await openRaw({ hash: '#mode=disaster&place=jp&view=country', intercept: withRiskChanges() });
    await jp.waitForSelector('#countryView [data-event]');
    await jp.click('#countryView [data-event="gdacs:TC:900"]');
    await sleep(900);
    assert.equal((await view(jp)).open, false);
    assert.match(await detailsTitle(jp), /Test cyclone gdacs:TC:900/);
    await jp.click('#modeSwitch [data-mode="travel"]');
    await sleep(300);
    await jp.click('#details [data-action="country"]');
    await jp.waitForSelector('#countryView .cv-name');
    assert.equal((await view(jp)).name, 'Japan', 'the travel card opens the country view too');
    assert.match(await jp.evaluate(() => location.hash), /^#mode=travel&place=jp&view=country$/);
    await jp.close();
  });
});

describe('countries list', () => {
  const list = (page) => page.evaluate(() => ({
    open: !document.getElementById('listView').hidden,
    card: getComputedStyle(document.getElementById('details')).display !== 'none',
    rows: [...document.querySelectorAll('#listRows button')].map(b => b.dataset.place),
    hash: location.hash,
  }));

  for (const [width, height] of [[1440, 860], [390, 844]]) {
    test(`at ${width}px opens from the overview, sorts, filters, opens a country and comes back`, async () => {
      const page = await openMode('highest', { width, height, stored: { mode: 'highest', risk: { recentDays: 90, listSort: 'level' } } });
      await page.click('#details [data-action="list"]');
      await page.waitForSelector('#listRows button');
      let s = await list(page);
      assert.equal(s.open, true);
      assert.equal(s.card, false, 'in place of the card');
      assert.ok(s.rows.length > 200, `${s.rows.length} rows`);
      assert.equal(s.hash, '#mode=highest&view=list');
      const levels = await page.$$eval('#listRows .swatch', els => els.map(e => e.getAttribute('style')));
      assert.match(levels[0], /--l4/, 'Critical first');
      await page.click('#listSort [data-sort="name"]');
      const names = await page.$$eval('#listRows .what', els => els.map(e => e.textContent));
      assert.deepEqual(names.slice(0, 5), [...names].sort((a, b) => a.localeCompare(b)).slice(0, 5));
      await page.type('#listFilter', 'japan');
      s = await list(page);
      assert.deepEqual(s.rows, ['jp']);
      await page.click('#listRows button');
      await page.waitForSelector('#countryView .cv-name');
      assert.equal(await page.$eval('#countryView .cv-name', el => el.textContent), 'Japan');
      assert.equal(await page.evaluate(() => location.hash), '#mode=highest&place=jp&view=country');
      await page.click('#countryView [data-action="back"]');
      s = await list(page);
      assert.equal(s.open, true, 'Back returns to the list');
      assert.deepEqual(s.rows, ['jp'], 'with its filter');
      assert.equal(await page.$eval('#listFilter', el => el.value), 'japan');
      await page.click('#listView [data-action="back"]');
      s = await list(page);
      assert.equal(s.open, false);
      assert.equal(s.card, true);
      assert.equal((await saved(page)).risk.listSort, 'name', 'the order is saved');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
      assert.deepEqual(page.errors, []);
      await page.close();
    });
  }

  test('a link opens it; Travel opens it from the header; a country on the map opens from it; Escape closes', async () => {
    const page = await openRaw({ hash: '#mode=disaster&view=list' });
    await page.waitForSelector('#listRows button');
    assert.match(await page.$eval('#listView .eyebrow', el => el.textContent), /Disasters/);
    await page.click('#modeSwitch [data-mode="travel"]');
    await sleep(300);
    let s = await list(page);
    assert.equal(s.open, true, 'kept across modes');
    assert.match(await page.$eval('#listView .eyebrow', el => el.textContent), /Highest/, 'Travel borrows the highest levels');
    assert.equal(s.hash, '#mode=travel&view=list');
    // A country clicked on the map opens its view; Back returns to the list.
    await page.evaluate(() => [...document.querySelectorAll('path.country')].find(e => e.__data__.key === 'br').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForSelector('#countryView .cv-name');
    assert.equal(await page.$eval('#countryView .cv-name', el => el.textContent), 'Brazil');
    await page.keyboard.press('Escape');
    assert.equal((await list(page)).open, true, 'Escape: back to the list');
    await page.keyboard.press('Escape');
    s = await list(page);
    assert.equal(s.open, false);
    assert.equal(s.hash, '#mode=travel&place=br');
    await page.click('#listOpen');
    await page.waitForSelector('#listRows button');
    assert.equal((await list(page)).open, true, 'the header button opens it');
    assert.deepEqual(page.errors, []);
    await page.close();
  });
});
