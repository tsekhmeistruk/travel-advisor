// Browser tests for the controls and interactions not covered by site.test.mjs: theme, panel,
// zoom buttons, tooltip, keyboard search, level filter, fading, feed hover, (de)selection,
// dots, load errors, languages (with a fake second locale) and accessible names.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useBrowser, open, openRaw, anchorOf, isSelected, sleep, click, detailsTitle, withLevelChanges, withRiskChanges } from './helpers.mjs';

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

describe('switches on the map', () => {
  // The mode switch (every mode) and, in Travel, the provider switch below it.
  const layout = (page) => page.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const modes = box('#modeSwitch'), zoom = box('.map-controls'), map = box('#mapArea');
    const providers = document.getElementById('providerSwitch').hidden ? null : box('#providerSwitch');
    const active = box('#modeSwitch [aria-checked="true"]');
    return {
      modesOverZoom: hits(modes, zoom), providersOverZoom: !!providers && hits(providers, zoom), modesOverProviders: !!providers && hits(modes, providers),
      inside: [modes, providers].filter(Boolean).every(b => b.left >= map.left && b.right <= map.right && b.top >= map.top),
      activeVisible: active.left >= modes.left - 1 && active.right <= modes.right + 1,
      providers: document.querySelectorAll('#providerSwitch button').length,
      pageScroll: document.documentElement.scrollWidth > innerWidth,
    };
  });
  for (const [width, height] of [[1440, 860], [390, 844], [320, 640]]) {
    test(`at ${width}px they sit on the map, apart from each other and the zoom controls`, async () => {
      const page = await open({ width, height });
      const travel = await layout(page);
      assert.ok(travel.providers >= 3, `${travel.providers} providers`);
      assert.deepEqual(travel, { ...travel, modesOverZoom: false, providersOverZoom: false, modesOverProviders: false, inside: true, activeVisible: true, pageScroll: false });
      await page.click('#modeSwitch [data-mode="highest"]');
      await page.waitForFunction(() => document.getElementById('providerSwitch').hidden);
      const last = await layout(page);
      assert.deepEqual(last, { ...last, modesOverZoom: false, inside: true, activeVisible: true, pageScroll: false }, 'the last mode (All) stays in view');
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

  test('one arrow on the map hides and shows the panel, turning with its state; it is remembered', async () => {
    const page = await open();
    const toggle = () => page.$eval('#panelToggle', el => ({
      label: el.getAttribute('aria-label'), title: el.title, expanded: el.getAttribute('aria-expanded'),
      turned: getComputedStyle(el.querySelector('svg')).transform !== 'none', seen: el.checkVisibility(),
    }));
    assert.equal(await page.$('#panelClose, #panelOpen'), null, 'no second arrow in the panel header');
    assert.deepEqual(await toggle(), { label: 'Hide panel', title: 'Hide panel', expanded: 'true', turned: true, seen: true }, 'open: ">"');
    await page.click('#panelToggle');
    assert.equal(await page.$eval('#app', el => el.classList.contains('panel-collapsed')), true);
    assert.deepEqual(await toggle(), { label: 'Show panel', title: 'Show panel', expanded: 'false', turned: false, seen: true }, 'hidden: "<"');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('#app', el => el.classList.contains('panel-collapsed')), true);
    assert.equal((await toggle()).expanded, 'false');
    await page.click('#panelToggle');
    assert.equal(await page.$eval('#app', el => el.classList.contains('panel-collapsed')), false);
    assert.equal((await toggle()).turned, true);
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

  test('a link to a place zooms to it; collapsing the panel or resizing keeps the zoom and the place in view', async () => {
    const page = await openRaw({ hash: '#mode=highest&place=de' });
    await page.waitForSelector('path.country');
    await sleep(1200);
    const zoomed = await scaleOf(page);
    assert.ok(zoomed > 1, `zoomed in (scale ${zoomed})`);
    const inView = () => page.evaluate(() => {
      const r = [...document.querySelectorAll('path.country')].find(e => e.__data__.key === 'de').getBoundingClientRect();
      const m = document.getElementById('mapArea').getBoundingClientRect();
      const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
      return x > m.left && x < m.right && y > m.top && y < m.bottom;
    });
    assert.equal(await inView(), true);
    await page.click('#panelToggle');
    await sleep(500);
    assert.equal(await scaleOf(page), zoomed, 'collapsing the panel keeps the zoom');
    assert.equal(await inView(), true, 'and the place in view');
    await page.setViewport({ width: 1100, height: 700 });
    await sleep(500);
    assert.equal(await scaleOf(page), zoomed, 'a resize keeps the zoom');
    assert.equal(await inView(), true, 'and the place in view');
    await page.close();
  });

  test('country names show once zoomed in: without overlaps, inside the map, and clicks still reach the countries', async () => {
    const page = await open();
    assert.equal(await page.$$eval('.map-label', els => els.length), 0, 'none at world zoom');
    await page.type('#search', 'germany');
    await page.keyboard.press('Enter');
    await sleep(1200);
    const labels = await page.$$eval('.map-label', els => els.map(e => { const r = e.getBoundingClientRect(); return { text: e.textContent, x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }; }));
    assert.ok(labels.length >= 8, `${labels.length} labels`);
    assert.ok(labels.some(l => l.text === 'Germany') && labels.some(l => l.text === 'France'), labels.map(l => l.text).join(', '));
    const overlap = (a, b) => a.x0 < b.x1 - 1 && a.x1 > b.x0 + 1 && a.y0 < b.y1 - 1 && a.y1 > b.y0 + 1;
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.equal(overlap(labels[i], labels[j]), false, `${labels[i].text} overlaps ${labels[j].text}`);
    const clear = await page.evaluate((list) => {
      const m = document.getElementById('mapArea').getBoundingClientRect();
      const top = document.getElementById('mapTop').getBoundingClientRect().bottom;
      const legend = document.getElementById('legend').getBoundingClientRect().top;
      return list.every(l => l.x0 >= m.left && l.x1 <= m.right && l.y0 >= top && l.y1 <= legend);
    }, labels);
    assert.equal(clear, true, 'inside the map, clear of the switches and the legend');
    // A click on a label selects the country under it.
    const france = labels.find(l => l.text === 'France');
    await click(page, { x: (france.x0 + france.x1) / 2, y: (france.y0 + france.y1) / 2 });
    assert.equal(await detailsTitle(page), 'France');
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

  test('hovering a feed item outlines its place on the map, the panel stays; clicking selects and zooms to it', async () => {
    const page = await open({ settings: { provider: 'us', recentDays: 90 }, intercept: withLevelChanges() });
    const first = await page.$('#recentList button');
    const name = await first.$eval('.name', el => el.textContent);
    const before = await page.$eval('#details', el => el.innerHTML);
    await first.hover();
    await sleep(150);
    assert.equal(await page.$eval('#details', el => el.innerHTML), before, 'hovering only informs: the panel stays');
    assert.equal(await page.$eval('.hover-outline', el => el.getAttribute('display') !== 'none'), true, 'the place is outlined on the map');
    assert.equal(await page.$eval('#recentList button', b => b.classList.contains('is-active')), true);
    await first.click();
    await sleep(100);
    assert.equal(await detailsTitle(page), name, 'a click shows it');
    await sleep(900);
    assert.equal(await isSelected(page), true);
    assert.ok(await scaleOf(page) > 1, 'zoomed to the place');
    await page.close();
  });
});

describe('settings', () => {
  test('a level in the legend hides those countries (muted) and their changes; a second click shows them', async () => {
    const page = await open({ settings: { provider: 'us', recentDays: 90 }, intercept: withLevelChanges() });
    const feedLevels = () => page.$$eval('#recentList .swatch', els => els.map(e => e.getAttribute('style')));
    assert.ok((await feedLevels()).some(s => s.includes('--l2')), 'feed has level 2 items to begin with');
    await page.click('#legend [data-level="2"]');
    await sleep(150);
    assert.equal(await page.$eval('#legend [data-level="2"]', b => b.getAttribute('aria-pressed')), 'false');
    assert.ok(await page.$$eval('path.country.l2', els => els.length > 0 && els.every(e => e.classList.contains('is-muted'))));
    assert.ok(!(await feedLevels()).some(s => s.includes('--l2')));
    await page.click('#legend [data-level="2"]');
    await sleep(150);
    assert.equal(await page.$$eval('path.country.l2.is-muted', els => els.length), 0, 'shown again');
    assert.equal(await page.$$eval('#filters', els => els.length), 0, 'no Filters in the panel');
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
    assert.match(await page.$eval('#recentTitle', el => el.textContent), /^\[ar\] /);
    assert.match(await page.$eval('#search', el => el.placeholder), /^\[ar\] /);
    // Country names come from the browser in the chosen language.
    await page.evaluate(() => [...document.querySelectorAll('path.country')].find(e => e.__data__.key === 'fr')
      .dispatchEvent(new MouseEvent('click', { bubbles: true })));
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

describe('phone sheet', () => {
  // An ocean point inside the map area, clear of the controls, legend and sheet.
  const mapOcean = (page) => page.evaluate(() => {
    const r = document.getElementById('mapArea').getBoundingClientRect();
    for (let y = r.top + 120; y < r.bottom - 90; y += 8) {
      for (let x = r.left + 60; x < r.right - 20; x += 8) {
        if (document.elementFromPoint(x, y)?.classList.contains('sphere')) return { x, y };
      }
    }
    return null;
  });
  const sheet = (page) => page.$eval('#sheet', el => ({ shown: !el.hidden && getComputedStyle(el).display !== 'none', text: el.innerText }));

  test('at 390px a tap on a country shows it over the map; Details scrolls to the card; the ocean and × close it', async () => {
    const page = await open({ width: 390, height: 844 });
    assert.equal((await sheet(page)).shown, false);
    await click(page, await anchorOf(page, 'br'));
    let s = await sheet(page);
    assert.equal(s.shown, true);
    assert.match(s.text, /Brazil[\s\S]*Level \d/);
    const inMap = await page.evaluate(() => {
      const a = document.getElementById('sheet').getBoundingClientRect(), m = document.getElementById('mapArea').getBoundingClientRect();
      return a.top >= m.top && a.bottom <= m.bottom && a.left >= m.left && a.right <= m.right;
    });
    assert.equal(inMap, true, 'inside the map area');
    await page.click('#sheetDetails');
    await sleep(800);
    assert.equal((await sheet(page)).shown, false);
    assert.equal(await detailsTitle(page), 'Brazil');
    await page.waitForSelector('#details > .block.cv-section');   // and its other blocks below
    const top = await page.$eval('#details', el => el.getBoundingClientRect().top);
    assert.ok(top >= -1 && top < 844 / 2, `the card scrolled into view (top ${top})`);
    await page.evaluate(() => scrollTo(0, 0));
    await sleep(400);   // scrolled back, and not a double-click
    await click(page, await anchorOf(page, 'au'));
    assert.match((await sheet(page)).text, /Australia/);
    const ocean = await mapOcean(page);
    assert.ok(ocean, 'found an ocean point');
    await click(page, ocean);
    assert.equal((await sheet(page)).shown, false, 'the ocean closes it');
    await sleep(400);
    await click(page, await anchorOf(page, 'au'));
    await page.click('#sheetClose');
    assert.equal((await sheet(page)).shown, false, '× closes it');
    assert.equal(await isSelected(page), true, 'and keeps the selection');
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('at 390px a tapped marker shows its event; a search does not open the sheet', async () => {
    // Green alerts hidden: Disasters also marks the many Green forest fires, which cluster with Chile's.
    const page = await openRaw({ width: 390, height: 844, stored: { mode: 'disaster', risk: { levels: [2, 3, 4] } }, intercept: withRiskChanges() });
    await page.waitForSelector('.marker');
    const box = await page.evaluate(() => {
      const m = [...document.querySelectorAll('.marker')].find(e => e.__data__.items.some(i => i.id === 'gdacs:EQ:0'));
      const r = m.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, n: m.__data__.items.length };
    });
    assert.equal(box.n, 1, 'the Chile test event is a marker of its own');
    await click(page, box);
    assert.match((await sheet(page)).text, /Test earthquake gdacs:EQ:0[\s\S]*Orange/);
    await page.type('#search', 'kenya');
    await page.keyboard.press('Enter');
    await sleep(300);
    assert.equal((await sheet(page)).shown, false, 'a choice in the panel closes it');
    await page.close();
  });

  test('at 1440px a click shows no sheet', async () => {
    const page = await open();
    await click(page, await anchorOf(page, 'br'));
    assert.equal((await sheet(page)).shown, false);
    await page.close();
  });
});
