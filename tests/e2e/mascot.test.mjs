// The mascot in Canada (site/js/map/mascot.js; the capybara, or the goose): where it stands, what
// a click on it does, who it is, and where it looks. Its timing (a look at the visitor after 15 s idle) is unit-tested in
// tests/unit/site/gaze.test.mjs, its acts in antics.test.mjs.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, open, openRaw, anchorOf, click, sleep } from './helpers.mjs';

useBrowser();

/** The mascot's box, its feet (the pin) and the map's box, in page px; its gaze. */
const mascot = (page) => page.evaluate(() => {
  const pin = document.querySelector('.pins > g');
  const m = pin.transform.baseVal.consolidate().matrix;
  const map = document.getElementById('map').getBoundingClientRect();
  const box = document.querySelector('.mascot').getBoundingClientRect();
  const el = document.querySelector('.mascot');
  return {
    map: { left: map.left, top: map.top, right: map.right, bottom: map.bottom },
    box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
    feet: { x: map.left + m.e, y: map.top + m.f },
    look: el.dataset.look, gx: Number(el.style.getPropertyValue('--gx')), gy: Number(el.style.getPropertyValue('--gy')),
  };
});

for (const [width, height] of [[1440, 860], [390, 844]]) {
  describe(`the mascot at ${width}px`, () => {
    let page, m;
    before(async () => {
      page = await openRaw({ width, height });
      await page.waitForSelector('.mascot');
      await sleep(300);   // the panel and legend settle the map's size
      m = await mascot(page);
    });
    after(async () => { await page?.close(); });

    test('is whole on the map at the widest view', () => {
      assert.ok(m.box.right - m.box.left > 20, `width ${m.box.right - m.box.left}`);
      assert.ok(m.box.left >= m.map.left && m.box.right <= m.map.right && m.box.top >= m.map.top && m.box.bottom <= m.map.bottom, JSON.stringify(m));
    });

    test('stands in Canada, and takes the pointer itself', async () => {
      // Canada is under its feet: hidden, the pointer finds the country there.
      const under = (x, y) => page.evaluate((x, y) => {
        const pins = document.querySelector('.pins');
        pins.style.display = 'none';
        const e = document.elementFromPoint(x, y);
        pins.style.display = '';
        return e?.__data__?.key ?? `${e?.tagName}.${e?.getAttribute('class')}`;
      }, x, y);
      assert.equal(await under(m.feet.x, m.feet.y - 2), 'ca');
      const middle = await page.evaluate((x, y) => !!document.elementFromPoint(x, y)?.closest('.mascot'), (m.box.left + m.box.right) / 2, (m.box.top + m.box.bottom) / 2);
      assert.equal(middle, true, 'its body is what the pointer finds');
    });

    test('a click on it plays one act to the end: Canada is not selected, and clicks meanwhile change nothing', async () => {
      const antic = () => page.$eval('.mascot', el => el.dataset.antic ?? null);
      const middle = { x: (m.box.left + m.box.right) / 2, y: (m.box.top + m.box.bottom) / 2 };
      assert.equal(await antic(), null);
      await click(page, middle);
      const first = await antic();
      assert.ok(['paw', 'nose', 'glasses', 'smile', 'hop', 'walk'].includes(first), `act: ${first}`);
      assert.equal(await page.$('.select-outline:not([display="none"])'), null, 'the map got no click');
      assert.equal(await page.$eval('#details', el => !!el.querySelector('.block.selected')), false, 'nothing selected');
      await sleep(500);
      // It is small on the map: for an act it steps closer, almost twice its size (the walk aside).
      const height = await page.$eval('.mascot', el => el.getBoundingClientRect().height);
      if (first !== 'walk') assert.ok(height > (m.box.bottom - m.box.top) * 1.6, `closer: ${height}px against ${m.box.bottom - m.box.top}px`);
      assert.equal(await page.$eval('.mascot', el => Number(el.style.getPropertyValue('--ms'))) >= 2000, true, 'the act\'s time is given to the CSS');
      await click(page, middle);
      await click(page, middle);
      assert.equal(await antic(), first, 'the same act goes on');
      await page.waitForFunction(() => !document.querySelector('.mascot').dataset.antic, { timeout: 7000 });   // the walk is the longest
      await sleep(300);
      assert.equal(await antic(), null, 'no act was waiting its turn');
      await click(page, middle);
      const second = await antic();
      assert.ok(second && second !== first, `another act: ${second}`);
    });

    test('looks east at first', () => {
      assert.deepEqual([m.look, m.gx, m.gy], ['east', 1, 0]);
    });

    test('logs no console errors', () => { assert.deepEqual(page.errors, []); });
  });
}

describe('where the mascot looks', () => {
  let page;
  before(async () => { page = await open(); });   // Travel: a click on a country selects it without zooming
  after(async () => { await page?.close(); });

  test('down towards the U.S. or Brazil once chosen, and east again when cleared', async () => {
    await click(page, await anchorOf(page, 'us'));
    const us = await mascot(page);
    assert.equal(us.look, 'place');
    assert.ok(us.gy > 0.6, `gy ${us.gy}`);
    await click(page, await anchorOf(page, 'br'));
    const br = await mascot(page);
    assert.ok(br.gy > 0.9, `gy ${br.gy}`);
    await page.evaluate(() => document.getElementById('map').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal((await mascot(page)).look, 'east');
  });

  test('towards the east for a place there (Germany)', async () => {
    await click(page, await anchorOf(page, 'de'));
    const de = await mascot(page);
    assert.ok(de.gx > 0.9 && Math.abs(de.gy) < 0.3, `${de.gx}, ${de.gy}`);
  });
});

test('the mascot leaves the screen with Canada when the map zooms to another country', async () => {
  const page = await open({ hash: '#mode=travel&place=au' });
  await sleep(1200);   // the zoom's transition
  const { box, map } = await mascot(page);
  const overlaps = box.right > map.left && box.left < map.right && box.bottom > map.top && box.top < map.bottom;
  assert.equal(overlaps, false, JSON.stringify({ box, map }));
  await page.close();
});

describe('the characters', () => {
  const who = (page) => page.$eval('.mascot', el => el.dataset.character);
  const buttons = (page) => page.$$eval('#mascotSwitch button', els => els.map(b => [b.dataset.mascot, b.getAttribute('aria-pressed'), b.getAttribute('aria-label'), b.checkVisibility()]));

  for (const [width, height] of [[1440, 860], [390, 844]]) {
    test(`at ${width}px the switch by the zoom buttons changes who stands there, and it is remembered`, async () => {
      const page = await open({ width, height });
      assert.deepEqual(await buttons(page), [['capybara', 'true', 'Capybara', true], ['goose', 'false', 'Goose', true]]);
      assert.equal(await who(page), 'capybara');
      await page.click('[data-mascot="goose"]');
      assert.equal(await who(page), 'goose');
      assert.deepEqual((await buttons(page)).map(b => b[1]), ['false', 'true']);
      const m = await mascot(page);
      assert.ok(m.box.left >= m.map.left && m.box.right <= m.map.right && m.box.top >= m.map.top && m.box.bottom <= m.map.bottom, `the goose is whole on the map: ${JSON.stringify(m)}`);
      // The switch is clear of the zoom buttons and inside the map.
      const boxes = await page.evaluate(() => [...document.querySelectorAll('.map-controls button')].map(b => { const r = b.getBoundingClientRect(); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }; }));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        assert.equal(a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0, false, `buttons ${i} and ${j} overlap`);
      }
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('.mascot');
      assert.equal(await who(page), 'goose', 'remembered');
      await page.click('[data-mascot="capybara"]');
      assert.equal(await who(page), 'capybara');
      assert.deepEqual(page.errors, []);
      await page.close();
    });
  }

  test('the goose walks to the U.S. and back, to where it stood', async () => {
    const page = await open();
    await page.click('[data-mascot="goose"]');
    await page.evaluate(() => { Math.random = () => 0.99; });   // the last act of the list: the walk
    const feet = () => page.evaluate(() => {
      const r = document.querySelector('.mascot').getBoundingClientRect();
      const x = (r.left + r.right) / 2, y = r.bottom - 4;
      const pins = document.querySelector('.pins');
      pins.style.display = 'none';
      const under = document.elementFromPoint(x, y)?.__data__?.key ?? null;
      pins.style.display = '';
      return { x, y, under };
    });
    const home = await feet();
    assert.equal(home.under, 'ca');
    await click(page, { x: home.x, y: home.y - 25 });
    assert.equal(await page.$eval('.mascot', el => el.dataset.antic), 'walk');
    await sleep(2600);   // its far end: from 2.35 to 3.25 s
    const there = await feet();
    assert.equal(there.under, 'us', `in the U.S.: ${JSON.stringify(there)}`);
    assert.ok(there.y - home.y > 15, `${there.y - home.y}px down`);
    await page.waitForFunction(() => !document.querySelector('.mascot').dataset.antic, { timeout: 5000 });
    await sleep(200);
    const back = await feet();
    assert.ok(Math.abs(back.x - home.x) < 2 && Math.abs(back.y - home.y) < 3, `back home: ${JSON.stringify([home, back])}`);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
});
