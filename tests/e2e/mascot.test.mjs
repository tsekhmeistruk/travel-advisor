// The capybara in Canada (site/js/map/mascot.js): where it stands, that it never catches a click,
// and where it looks. Its timing (a look at the visitor after 15 s idle) is unit-tested in
// tests/unit/site/gaze.test.mjs.

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

    test('stands in Canada, and the pointer goes through it to the map', async () => {
      const under = (x, y) => page.evaluate((x, y) => { const e = document.elementFromPoint(x, y); return e?.__data__?.key ?? `${e?.tagName}.${e?.getAttribute('class')}`; }, x, y);
      assert.equal(await under(m.feet.x, m.feet.y - 2), 'ca');
      // Its middle (over Ontario or Hudson Bay): the pointer finds the map, not the drawing.
      const middle = await page.evaluate((x, y) => !!document.elementFromPoint(x, y)?.closest('#map') && !document.elementFromPoint(x, y).closest('.mascot'),
        (m.box.left + m.box.right) / 2, (m.box.top + m.box.bottom) / 2);
      assert.equal(middle, true);
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
