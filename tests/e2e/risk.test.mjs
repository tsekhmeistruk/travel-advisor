// Browser tests of the map modes: Wars, Disasters, Travel and All (Highest). Real published risk
// data, plus changes of known ages from withRiskChanges() (real ones are rare, as for levels).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useBrowser, open, openRaw, sleep, OUT, detailsTitle, withRiskChanges, measureCards, isData, SETTINGS_KEY } from './helpers.mjs';

useBrowser();

const RISK_MODES = ['wars', 'highest', 'disaster'];
// Pulses each mode must show with withRiskChanges(): its category's level changes, or all of them.
const MIN_PULSES = { wars: 1, highest: 7, disaster: 5 };   // Disasters: its level changes and the wildfire one
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
      test('pulses the level changes and lists them in the feed (Wars lists the wars instead)', () => {
        assert.ok(stats.pulses >= MIN_PULSES[mode], `${stats.pulses} pulses`);
        if (mode !== 'wars') assert.ok(stats.recent >= stats.pulses, `${stats.recent} listed, ${stats.pulses} pulses`);
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
    assert.match(await text(page, 'asOf'), /^([A-Z]+ delayed · )?Updated /, 'a delayed source may come first');
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
    await page.evaluate(() => { location.hash = '#mode=highest'; });
    await page.waitForFunction(() => document.querySelector('#modeSwitch [aria-checked="true"]').dataset.mode === 'highest');
    assert.match(await detailsTitle(page), /places? above Normal/, 'no place in the new hash: the overview');
    await page.close();
  });

  test('four tabs; the old Changes and Wildfires modes lead to Wars and Disasters, in a link or saved', async () => {
    const page = await openRaw({ hash: '#mode=changes', stored: { mode: 'travel' } });
    await page.waitForSelector('path.country');
    assert.deepEqual(await page.$$eval('#modeSwitch [role="radio"]', els => els.map(b => b.textContent.trim())), ['Wars', 'Disasters', 'Travel', 'All']);
    assert.equal(await checked(page, '#modeSwitch'), 'wars', '#mode=changes');
    await page.close();
    const fires = await openRaw({ stored: { mode: 'wildfire' } });
    await fires.waitForSelector('path.country');
    assert.equal(await checked(fires, '#modeSwitch'), 'disaster', 'a saved Wildfires');
    assert.equal((await saved(fires)).mode, 'disaster', 'and the saved mode is migrated');
    assert.equal(await fires.$$eval('#newsSection', els => els.length), 0, 'no news list on the front');
    await fires.close();
  });

  test('the map\'s tooltip keeps its text inside the box, whatever the country', async () => {
    const page = await openMode('disaster', { intercept: withRiskChanges() });
    const out = await page.evaluate(() => {
      const tip = document.getElementById('tooltip');
      const bad = [];
      for (const el of document.querySelectorAll('path.country')) {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
        if (!tip.hidden && (tip.scrollWidth > tip.clientWidth + 1 || [...tip.querySelectorAll('*')].some(c => c.getBoundingClientRect().right > tip.getBoundingClientRect().right + 1))) bad.push(el.__data__.key);
        el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
      }
      return bad;
    });
    assert.deepEqual(out, []);
    await page.close();
  });


  // Fresh and healthy, or stale with every source delayed: the header stays one line either way.
  const currentAs = (state) => {
    const current = JSON.parse(readFileSync(new URL('../../site/data/risk/current.json', import.meta.url), 'utf8'));
    if (state === 'fresh') return { ...current, asOf: new Date().toISOString(), categories: Object.fromEntries(Object.entries(current.categories).map(([c, m]) => [c, { ...m, status: 'healthy' }])) };
    return { ...current, asOf: new Date(Date.now() - 3 * 86400000).toISOString(), categories: Object.fromEntries(Object.entries(current.categories).map(([c, m]) => [c, { ...m, status: 'delayed' }])) };
  };
  for (const [width, height] of [[1440, 860], [390, 844]]) {
    for (const state of ['fresh', 'delayed']) {
      test(`at ${width}px the panel does not move between Travel and the risk modes (${state} data)`, async () => {
        const body = JSON.stringify(currentAs(state));
        const serve = (req) => isData(req, 'risk/current.json') && (req.respond({ status: 200, contentType: 'application/json', body }), true);
        // The UK has the longest agency name, which used to wrap the Travel header.
        const page = await open({ width, height, settings: { provider: 'uk' }, intercept: serve });
        const top = () => page.$eval('#search', el => Math.round(el.getBoundingClientRect().top + scrollY));
        const travel = await top();
        for (const mode of ['highest', 'disaster', 'wars']) {
          await page.click(`#modeSwitch [data-mode="${mode}"]`);
          await page.waitForFunction((m) => document.querySelector('#modeSwitch [aria-checked="true"]').dataset.mode === m, {}, mode);
          assert.equal(await top(), travel, mode);
          if (state === 'delayed' && mode !== 'wars') {
            assert.match(await page.$eval('#asOf', el => el.title), /delayed/, `${mode}: the whole header in the tooltip`);
          }
        }
        await page.close();
      });
    }
  }

  test('a first visit opens on Wars; a saved Travel or Highest is kept', async () => {
    const first = await openRaw({ stored: {} });
    await first.waitForSelector('path.country');
    assert.equal(await checked(first, '#modeSwitch'), 'wars');
    assert.equal(await first.$eval('#modeSwitch [role="radio"]', el => el.dataset.mode), 'wars', 'the first tab');
    assert.equal(await first.evaluate(() => document.title), 'Risk Monitor');
    await first.close();
    for (const mode of ['travel', 'highest']) {
      const back = await openRaw({ stored: { mode } });
      await back.waitForSelector('path.country');
      assert.equal(await checked(back, '#modeSwitch'), mode);
      await back.close();
    }
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
    assert.match(await text(page, 'footer'), /^Sources: .*GDACS.* · How it works$/, 'one line: the sources and "How it works" (that the levels are ours is in the help)');
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

  test('Wars: the war count from the published figures; an escalating place opens its card with 12 months of deaths', async () => {
    const page = await openMode('wars');
    const conflict = await page.evaluate(async () => (await fetch('data/risk/conflict.json')).json());
    assert.equal(await page.$eval('#details .wars-count b', el => el.textContent), String(conflict.series.wars.at(-1)));
    assert.match(await text(page, 'asOf'), /^Conflict data to \w+ \d{4}$/);
    const tensions = await page.$$eval('#details .wars-tensions button[data-place]', els => els.map(b => b.querySelector('.name').textContent));
    const published = Object.keys((await page.evaluate(async () => (await fetch('data/risk/current.json')).json())).activity?.gdelt?.tensions?.pairs ?? {});
    assert.equal(tensions.length, Math.min(3, published.length), 'up to three tensions, as published');
    const chip = await page.$('#details .wars-chips button[data-place]');
    if (chip) {
      const place = await chip.evaluate(b => b.dataset.place);
      await chip.click();
      await sleep(900);
      await page.hover('#footer');
      assert.match(await page.evaluate(() => location.hash), new RegExp(`place=${place}`));
      assert.equal(await page.$$eval('#details .wars-bars rect', els => els.length), 12);
      assert.equal(await page.$eval('#details .trend .arrow', el => el.classList.contains('up')), true, 'an escalating place says so');
    }
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('the 7 / 30 / 90 days switch in the Latest changes block filters it and is saved', async () => {
    const page = await openMode('highest', { intercept: withRiskChanges() });
    assert.equal(await text(page, 'recentTitle'), 'Latest changes');
    await page.click('#riskWindowSeg [data-days="7"]');
    await sleep(200);
    assert.equal(await checked(page, '#riskWindowSeg'), '7');
    // Real changes may be listed too: check the injected ones, not a total.
    const keys = await page.$$eval('#recentList button[data-key]', els => els.map(b => b.dataset.key));
    assert.ok(keys.includes('test:event'), 'the 2-hour event');
    assert.ok(keys.some(k => k.startsWith('jp:disaster:')), 'the 1-hour level change');
    assert.ok(!keys.some(k => k.startsWith('it:disaster:')), 'not the 10-day-old one');
    assert.equal((await saved(page)).risk.recentDays, 7);
    await page.close();
  });


  test('an empty window: the Latest changes block is its heading, 0 and the switch', async () => {
    const none = (req) => isData(req, 'risk/changes.json') && (req.respond({ status: 200, contentType: 'application/json', body: '{"changes":[]}' }), true);
    const page = await openMode('highest', { stored: { mode: 'highest', risk: { recentDays: 7 } }, intercept: none });
    assert.equal(await page.$$eval('#recentList li', els => els.length), 0);
    assert.equal(await text(page, 'recentCount'), '0');
    await page.click('#riskWindowSeg [data-days="90"]');
    await sleep(200);
    assert.equal((await saved(page)).risk.recentDays, 90);
    await page.close();
  });

  test('no Filters in any mode: the levels are switched in the legend, the overview is blocks', async () => {
    const page = await openRaw({ stored: {} });
    await page.waitForSelector('path.country');
    for (const mode of ['wars', 'disaster', 'travel', 'highest']) {
      await page.click(`#modeSwitch [data-mode="${mode}"]`);
      await sleep(400);
      assert.equal(await page.$$eval('#filters, #riskLevelChips, #levelChips', els => els.length), 0, mode);
      assert.ok(await page.$$eval('#legend .legend-toggle', els => els.length) >= 4, `${mode}: the levels in the legend`);
      assert.ok(await page.$$eval('#details > .block', els => els.length) >= 1, `${mode}: the overview in blocks`);
      assert.equal(await page.$$eval('#details [data-action="list"]', els => els.length), 0, `${mode}: no All countries link (the header has it)`);
    }
    assert.deepEqual(page.errors, []);
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
    assert.match(await text(page, 'asOf'), /^([A-Z]+ delayed · )?Updated (a day|1 day|yesterday)[^:]*: newer data is delayed/);
    assert.equal(await page.$eval('#asOf', el => el.classList.contains('is-stale')), true);
    await page.close();
  });

  test('the feed groups a place\'s changes in a category into one row, saying how many earlier ones', async () => {
    const extra = (req) => {
      if (!isData(req, 'risk/changes.json')) return false;
      const data = JSON.parse(readFileSync(new URL('../../site/data/risk/changes.json', import.meta.url), 'utf8'));
      const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
      const lvl = (h, from, to) => ({ id: `fj:disaster:${ago(h)}`, at: ago(h), kind: 'level', category: 'disaster', placeId: 'fj', from, to, up: to > from, basis: [], sources: ['gdacs'] });
      req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...data, changes: [lvl(1, 3, 2), lvl(5, 4, 3), lvl(9, 1, 4), ...data.changes] }) });
      return true;
    };
    const page = await openMode('highest', { intercept: extra });
    const rows = await page.$$eval('#recentList button[data-key]', els => els.filter(b => b.dataset.key.startsWith('fj:')).map(b => b.textContent.replace(/\s+/g, ' ').trim()));
    assert.equal(rows.length, 1, 'Fiji\'s three disaster changes: one row');
    assert.match(rows[0], /Fiji .*Disaster: High → Elevated · and 2 earlier/);
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

  test('news activity is not in the feed; the card says it, as it is now', async () => {
    const page = await openMode('highest', { intercept: withRiskChanges() });
    const keys = await page.$$eval('#recentList button[data-key]', els => els.map(b => b.dataset.key));
    assert.ok(keys.includes('test:event') && !keys.includes('test:news'), 'the 3-hour-old anomaly is not listed between the newer changes');
    assert.equal(await page.$eval('#recentList', el => /GDELT/.test(el.textContent)), false, 'no news item in the feed');
    await page.type('#search', 'new zealand');
    await page.keyboard.press('Enter');
    await sleep(900);
    await page.hover('#footer');
    assert.match(await page.$eval('#details', el => el.textContent), /News: Protest reports far above normal \(GDELT\)/);
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

  test('hovering a feed item outlines its place, the panel stays; clicking selects it; Escape and × clear it', async () => {
    const page = await openMode('disaster', { intercept: withRiskChanges() });
    const first = await page.$('#recentList button');
    await first.hover();
    assert.notEqual(await detailsTitle(page), 'Japan', 'hovering only informs');
    assert.equal(await page.$eval('.hover-outline', el => el.getAttribute('display') !== 'none'), true);
    await first.click();
    await sleep(900);
    await page.hover('#footer');   // off the feed and the map: the selection shows
    assert.equal(await detailsTitle(page), 'Japan');
    assert.match(await page.$eval('#details', el => el.textContent), /Raised in the last 24 hours/);
    await page.keyboard.press('Escape');
    assert.notEqual(await detailsTitle(page), 'Japan', 'Escape clears the selection');
    // Through the DOM: a mouse click at a position can miss while the map zooms.
    await page.$eval('#recentList button', b => b.click());
    await page.waitForSelector('#details [data-action="close"]', { visible: true });
    await page.$eval('#details [data-action="close"]', b => b.click());
    assert.notEqual(await detailsTitle(page), 'Japan', '× clears it');
    assert.equal(await page.evaluate(() => location.hash), '#mode=disaster');
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

  test('hovering a marker explains it in the tooltip, the panel stays; clicking selects it and its place', async () => {
    const page = await openMode('disaster', { intercept: withRiskChanges() });
    const el = await page.evaluateHandle(() => [...document.querySelectorAll('.marker')].find(e => e.__data__.id === 'gdacs:EQ:0'));
    await el.hover();
    assert.doesNotMatch(await detailsTitle(page) ?? '', /Test earthquake/);
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

  test('the highest mode shows only major alerts, Wars and Travel none; hidden levels hide markers', async () => {
    const page = await openMode('highest', { intercept: withRiskChanges() });
    const ids = async () => (await markers(page)).flatMap(m => m.id.replace(/^cluster:/, '').split('|'));
    assert.ok((await ids()).includes('gdacs:TC:900'));
    assert.ok(!(await ids()).includes('gdacs:FL:901'), 'a Green alert is not major');
    await page.click('#legend [data-level="4"]');
    await sleep(200);
    assert.ok(!(await ids()).includes('gdacs:TC:900'), 'Critical hidden, from the legend');
    await page.click('#modeSwitch [data-mode="wars"]');
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
      assert.equal(await page.$$eval('#modeSwitch button', els => els.length), 4);
      await page.close();
    });
  }
});

describe('a selected country\'s blocks', () => {
  const blocks = (page) => page.evaluate(() => ({
    title: document.querySelector('#details .selected h3')?.textContent ?? null,
    blocks: document.querySelectorAll('#details > .block').length,
    text: document.getElementById('details').innerText,
    hash: location.hash,
  }));
  const placeBlocksShown = (page) => page.waitForSelector('#details > .block.cv-section');

  for (const [width, height] of [[1440, 860], [390, 844]]) {
    test(`at ${width}px a selection shows its block, then short blocks from the place file; × clears it`, async () => {
      const page = await openMode('highest', { width, height, intercept: withRiskChanges() });
      await page.type('#search', 'japan');
      await page.keyboard.press('Enter');
      await placeBlocksShown(page);
      const b = await blocks(page);
      assert.equal(b.title, 'Japan');
      assert.ok(b.blocks >= 3, `${b.blocks} blocks`);
      assert.match(b.text, /Disaster: Normal → Critical/, 'its injected level change, in its block');
      assert.match(b.text, /Test cyclone gdacs:TC:900/, 'its injected alert, in the alerts block');
      assert.match(b.text, /U\.S\.[\s\S]*Level \d · /, 'each government in its own words');
      assert.equal(b.hash, '#mode=highest&place=jp');
      assert.equal(await page.$$eval('#details [data-action="country"], #countryView', els => els.length), 0, 'no Country details link or country view');
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(scroll <= width, `scrollWidth ${scroll}`);
      await page.screenshot({ path: `${OUT}selected-${width}.png`, fullPage: width < 600 });
      await page.$eval('#details [data-action="close"]', el => el.click());
      assert.equal((await blocks(page)).title, null, 'the overview again');
      assert.deepEqual(page.errors, []);
      await page.close();
    });
  }

  test('Share copies the link to the selected country, and says so', async () => {
    const page = await openRaw({ hash: '#mode=highest&place=jp' });
    await page.waitForSelector('#details [data-action="share"]');
    const at = new URL(page.url());
    await page.browserContext().overridePermissions(at.origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
    await page.click('#details [data-action="share"]');
    await page.waitForSelector('#toast:not([hidden])');
    assert.equal(await page.$eval('#toast', el => el.textContent), 'Link copied');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${at.origin}${at.pathname}#mode=highest&place=jp`);
    await page.waitForSelector('#toast[hidden]', { timeout: 4000 });   // and goes away
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('an old link to a country view selects the country; another choice follows; Escape clears it', async () => {
    const page = await openRaw({ hash: '#mode=disaster&place=mx&view=country', intercept: withRiskChanges() });
    await placeBlocksShown(page);
    assert.equal((await blocks(page)).title, 'Mexico');
    await page.type('#search', 'japan');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#details .selected h3')?.textContent === 'Japan');
    await page.keyboard.press('Escape');
    const b = await blocks(page);
    assert.equal(b.title, null);
    assert.equal(b.hash, '#mode=disaster');
    await page.close();
  });

  test('an alert in its block opens the alert\'s card; Travel shows the same blocks below its own', async () => {
    const page = await openRaw({ hash: '#mode=disaster&place=jp', intercept: withRiskChanges() });
    await page.waitForSelector('#details [data-event="gdacs:TC:900"]');
    await page.click('#details [data-event="gdacs:TC:900"]');
    await sleep(300);
    assert.match(await detailsTitle(page), /Test cyclone gdacs:TC:900/);
    await page.close();
    const travel = await openRaw({ hash: '#mode=travel&place=jp', intercept: withRiskChanges() });
    await placeBlocksShown(travel);
    const b = await blocks(travel);
    assert.equal(b.title, 'Japan');
    assert.match(b.text, /Armed violence \(UCDP\)/i, 'Travel borrows the risk blocks');
    assert.deepEqual(travel.errors, []);
    await travel.close();
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
    test(`at ${width}px opens from the header, sorts, filters, and choosing a country closes it and selects it`, async () => {
      const page = await openMode('highest', { width, height, stored: { mode: 'highest', risk: { recentDays: 90, listSort: 'level' } } });
      await page.click('#listOpen');
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
      await page.waitForSelector('#details > .block.cv-section');
      s = await list(page);
      assert.equal(s.open, false, 'the list makes way for the selection');
      assert.equal(await detailsTitle(page), 'Japan');
      assert.equal(s.hash, '#mode=highest&place=jp');
      await page.click('#listOpen');
      await page.waitForSelector('#listRows button');
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

  test('a link opens it; it stays across modes; a country on the map closes it and is selected', async () => {
    const page = await openRaw({ hash: '#mode=disaster&view=list' });
    await page.waitForSelector('#listRows button');
    assert.match(await page.$eval('#listView .eyebrow', el => el.textContent), /Disasters/);
    await page.click('#modeSwitch [data-mode="travel"]');
    await sleep(300);
    let s = await list(page);
    assert.equal(s.open, true, 'kept across modes');
    assert.match(await page.$eval('#listView .eyebrow', el => el.textContent), /All/, 'Travel borrows the highest levels (All)');
    assert.equal(s.hash, '#mode=travel&view=list');
    // A country clicked on the map: the list makes way for its blocks.
    await page.evaluate(() => [...document.querySelectorAll('path.country')].find(e => e.__data__.key === 'br').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    s = await list(page);
    assert.equal(s.open, false);
    assert.equal(await detailsTitle(page), 'Brazil');
    assert.equal(s.hash, '#mode=travel&place=br');
    await page.keyboard.press('Escape');
    assert.equal(await page.$('#details .selected'), null, 'Escape clears the selection');
    await page.click('#listOpen');
    await page.waitForSelector('#listRows button');
    assert.equal((await list(page)).open, true, 'the header button opens it');
    assert.deepEqual(page.errors, []);
    await page.close();
  });
});

describe('Wars: who fights whom', () => {
  const published = (name) => JSON.parse(readFileSync(new URL(`../../site/data/risk/${name}.json`, import.meta.url), 'utf8'));
  const conflict = published('conflict');
  const wars = published('wars');
  const keys = Object.keys(conflict.conflicts);
  // A war with an article (Wikipedia's title and summary) and several groups on side B.
  const sudanLike = keys.find(k => conflict.conflicts[k].war && wars.conflicts[k] && conflict.conflicts[k].sides.b.length > 1) ?? keys[0];
  const sideClasses = (page) => page.$$eval('path.country', els => {
    const count = (c) => els.filter(e => e.classList.contains(c)).length;
    return { a: count('side-a'), b: count('side-b'), muted: count('is-muted') };
  });

  test('the Wars list replaces the feed: the deadliest first, then all of them and those gone quiet; no Filters', async () => {
    const page = await openMode('wars');
    assert.equal(await text(page, 'recentTitle'), 'Wars and armed conflicts');
    assert.equal(await text(page, 'recentCount'), String(keys.length));
    const rows = () => page.$$eval('#recentList button[data-key^="war:"]', els => els.map(b => b.dataset.key.slice(4)));
    assert.deepEqual(await rows(), keys.slice(0, 5), 'the first 5, most deaths first');
    assert.match(await page.$eval('#recentList button[data-key]', b => b.querySelector('.name').textContent), / vs /, 'who fights whom');
    await page.click('#recentList [data-feed-all]');
    assert.deepEqual((await rows()).slice(0, keys.length), keys);
    if (conflict.quiet.length) assert.equal(await page.$eval('#recentList .recent-sub', el => el.textContent), 'Gone quiet');
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('hovering a war colours its sides, the panel stays; leaving restores the map; a click shows its card, zooms and goes in the URL', async () => {
    const page = await openMode('wars');
    const row = `#recentList button[data-key="war:${sudanLike}"]`;
    await page.hover(row);
    assert.equal(await page.$$eval('#details .wars-count', els => els.length), 1, 'hovering only informs: the overview stays');
    const shown = await sideClasses(page);
    assert.ok(shown.a >= 1 && shown.muted > 150, JSON.stringify(shown));
    await page.hover('#footer');
    assert.deepEqual(await sideClasses(page), { a: 0, b: 0, muted: 0 }, 'the usual map again');
    assert.equal(await page.$$eval('#details .wars-count', els => els.length), 1, 'the overview again');
    await page.click(row);
    await sleep(900);
    await page.hover('#footer');
    assert.equal(await detailsTitle(page), wars.conflicts[sudanLike].title.replace(/\s*\([^()]*\)\s*$/, ''));
    assert.equal(await page.$$eval('#details .war-side', els => els.length), 2);
    assert.equal(await page.evaluate(() => location.hash), `#mode=wars&war=${sudanLike.replace(':', '-')}`);
    assert.ok((await sideClasses(page)).a >= 1, 'kept while the pointer is elsewhere');
    assert.ok(await page.$eval('.viewport', el => !/scale\(1\)$/.test(el.getAttribute('transform') ?? '') && /scale/.test(el.getAttribute('transform') ?? '')), 'zoomed to where it is fought');
    assert.equal(await page.$eval(row, b => b.classList.contains('is-active')), true);
    await page.click('#map', { offset: { x: 5, y: 400 } });   // the ocean clears the selection
    await sleep(200);
    assert.deepEqual(await sideClasses(page), { a: 0, b: 0, muted: 0 });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('a link opens a war; a side\'s country and the place card\'s conflicts lead on; the search finds a war', async () => {
    const page = await openRaw({ hash: `#mode=wars&war=${sudanLike.replace(':', '-')}` });
    await page.waitForSelector('#details .war-sides');
    assert.ok((await sideClasses(page)).a >= 1, 'the link colours the sides');
    const place = await page.$eval('#details .war-side.a button[data-place]', b => b.dataset.place);
    await page.click('#details .war-side.a button[data-place]');
    await sleep(900);
    await page.hover('#footer');
    assert.match(await page.evaluate(() => location.hash), new RegExp(`place=${place}`), 'a side\'s country opens its card');
    const war = await page.$eval('#details .wars-conflicts button[data-war]', b => b.dataset.war);
    await page.click('#details .wars-conflicts button[data-war]');
    await sleep(300);
    await page.hover('#footer');
    assert.equal(await page.$$eval('#details .war-sides', els => els.length), 1, 'its conflict opens the war card');
    assert.equal(await page.evaluate(() => location.hash), `#mode=wars&war=${war.replace(':', '-')}`);
    await page.click('#search');
    await page.type('#search', 'Russia vs');
    await page.waitForSelector('#searchResults li');
    await page.keyboard.press('Enter');
    await sleep(300);
    assert.match(await page.evaluate(() => location.hash), /war=1-13243/, 'Russia vs Ukraine');
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('the month\'s deaths are one dot per country: explained on hover, a click picks its deadliest war; the footer\'s "How it works" opens the help', async () => {
    const page = await openMode('wars');
    const events = published('conflict-events').events;
    const places = [...new Set(events.map(e => e[7]).filter(Boolean))];
    assert.equal(await page.$$eval('.points .point', els => els.length), places.length, 'one per country, not one per event');
    // Ukraine: its deadliest conflict of the month is Russia – Ukraine.
    const dot = await page.evaluateHandle(() => [...document.querySelectorAll('.points .point')].find(el => el.__data__.id === 'ua'));
    await dot.hover();
    assert.match(await page.$eval('#tooltip', el => el.textContent), /Ukraine.*\d+ deaths/s);
    assert.match(await page.$eval('#tooltip', el => el.textContent), /Russia vs Ukraine/);
    await dot.click();
    await sleep(300);
    assert.equal(await page.evaluate(() => location.hash), '#mode=wars&war=1-13243');
    assert.ok(await page.$$eval('.points .point.is-dim', els => els.length) > 0, 'the other countries\' dots fade');
    assert.match(await page.$eval('#legend', el => el.textContent), /Deaths in \w+ \d{4}/);
    await page.click('#footer [data-action="help"]');
    assert.equal(await page.$eval('#help', el => el.open), true);
    assert.match(await page.$eval('#help', el => el.textContent), /who fights whom/);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
  test('a war or a place too big to zoom into keeps the world in view (the pan limits hold)', async () => {
    for (const hash of ['#mode=wars&war=1-13243', '#mode=wars&place=ru']) {
      const page = await openRaw({ hash });
      await page.waitForSelector('path.country');
      await sleep(1000);   // the zoom's transition
      const t = await page.$eval('.viewport', el => el.getAttribute('transform'));
      const [, x, y, k] = t.match(/translate\(([-\d.e]+),([-\d.e]+)\) scale\(([\d.]+)\)/).map(Number);
      if (k === 1) assert.deepEqual([Math.abs(Math.round(x)), Math.abs(Math.round(y))], [0, 0], `${hash}: ${t}`);
      const sphere = await page.$eval('.sphere', el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
      assert.ok(sphere.top < 300 && sphere.bottom > 500, `${hash}: the world on screen ${JSON.stringify(sphere)}`);
      await page.close();
    }
  });
});

describe('Disasters markers and the one-line footers', () => {
  const events = JSON.parse(readFileSync(new URL('../../site/data/risk/events.json', import.meta.url), 'utf8')).events;

  test('USGS quakes and EONET volcanoes are markers in Disasters, counted on the overview; a quake\'s card has its magnitude and no level of ours', async () => {
    const page = await openMode('disaster');
    const shown = events.filter(e => e.point && ['disaster', 'wildfire'].includes(e.category)).length;
    assert.match(await text(page, 'details'), new RegExp(`${shown} alerts? on the map`));
    const quake = events.find(e => e.source === 'usgs');
    assert.ok(quake, 'the published events have USGS quakes');
    assert.ok(events.some(e => e.source === 'eonet'), 'and EONET volcanoes');
    await page.click('#search');
    await page.type('#search', quake.name.slice(0, 24));
    await page.waitForSelector('#searchResults li');
    await page.keyboard.press('Enter');
    await sleep(300);
    await page.hover('#footer');
    assert.match(await text(page, 'details'), /USGS alert · Disaster/);
    assert.match(await page.$eval('#details .badge', el => el.textContent), /^Magnitude \d$/, 'no "· Normal": a marker has no level');
    assert.match(await text(page, 'details'), /USGS locates earthquakes worldwide/);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  for (const mode of ['wars', 'disaster', 'travel', 'highest']) {
    test(`${mode}: the footer names the mode's sources, and "How it works" opens the help`, async () => {
      const page = mode === 'travel' ? await open() : await openMode(mode);
      assert.match(await text(page, 'footer'), / · How it works$/);
      if (mode === 'disaster') assert.match(await text(page, 'footer'), /GDACS.*USGS.*NASA EONET/);
      if (mode === 'disaster') assert.doesNotMatch(await text(page, 'footer'), /U\.S\./, 'not the governments: Disasters\' own sources');
      await page.click('#footer [data-action="help"]');
      assert.equal(await page.$eval('#help', el => el.open), true);
      assert.match(await page.$eval('#help', el => el.textContent), /USGS/);
      await page.close();
    });
  }
});
