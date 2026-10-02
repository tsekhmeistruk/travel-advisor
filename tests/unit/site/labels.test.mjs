// Country names on the zoomed-in map: which ones fit (site/js/map/labels.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { placeLabels } from '../../../site/js/map/labels.js';

const VIEW = { width: 400, height: 300, charWidth: 10, lineHeight: 10, pad: 0, minArea: 100 };
const label = (key, x, y, area, text = key) => ({ key, x, y, area, text });
const keys = (list) => list.map(l => l.key);

describe('placeLabels', () => {
  test('the largest places come first, and a smaller one that would overlap is left out', () => {
    // "Big" is 30px wide around x=100; "Small" (50px) at x=120 overlaps it; "Far" doesn't.
    const out = placeLabels([label('Small', 120, 100, 500), label('Big', 100, 100, 5000), label('Far', 300, 100, 200)], VIEW);
    assert.deepEqual(keys(out), ['Big', 'Far']);
    assert.deepEqual(out[0], { key: 'Big', x: 100, y: 100, text: 'Big' });
  });
  test('a label must fit inside the view, clear of the top and bottom insets', () => {
    const view = { ...VIEW, top: 40, bottom: 30 };
    const out = placeLabels([
      label('Edge', 10, 150, 900),     // 40px wide around x=10: runs off the left edge
      label('Top', 200, 42, 900),      // 10px high around y=42: into the top inset
      label('Bottom', 200, 268, 900),  // into the bottom inset (300 - 30)
      label('Ok', 200, 150, 900),
    ], view);
    assert.deepEqual(keys(out), ['Ok']);
  });
  test('too small a place, or no name, gets no label; at most `max` labels', () => {
    assert.deepEqual(keys(placeLabels([label('Tiny', 200, 150, 99), label('', 100, 100, 900)], VIEW)), []);
    const many = Array.from({ length: 20 }, (_, i) => label(`p${i}`, 20 + (i % 10) * 38, 40 + Math.floor(i / 10) * 40, 1000 - i, 'ab'));
    assert.equal(placeLabels(many, { ...VIEW, max: 7 }).length, 7);
    assert.equal(placeLabels(many, VIEW).length, 20, 'all fit when they don\'t overlap');
  });
  test('labels side by side touch but do not overlap', () => {
    // Two 20px-wide labels whose boxes share an edge (x = 110).
    assert.deepEqual(keys(placeLabels([label('ab', 100, 100, 900), label('cd', 120, 100, 800)], VIEW)), ['ab', 'cd']);
  });
});
