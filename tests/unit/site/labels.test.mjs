// Country names on the zoomed-in map: which ones fit (site/js/map/labels.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { placeLabels, labelZoom } from '../../../site/js/map/labels.js';

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

describe('the selected place (first)', () => {
  test('is named before a larger neighbour, and from a smaller size', () => {
    // "Small" overlaps "Big" (see above): as the selected place it wins, and "Big" is left out.
    const places = [label('Small', 120, 100, 500), label('Big', 100, 100, 5000), label('Far', 300, 100, 200)];
    assert.deepEqual(keys(placeLabels(places, { ...VIEW, first: 'Small' })), ['Small', 'Far']);
    assert.deepEqual(keys(placeLabels([label('Lux', 100, 100, 30), label('Big', 300, 100, 500)], { ...VIEW, first: 'Lux', firstMinArea: 25 })), ['Lux', 'Big']);
    assert.deepEqual(keys(placeLabels([label('Lux', 100, 100, 30)], { ...VIEW, first: 'Lux' })), [], 'no smaller size given: the usual one');
  });
  test('labelZoom zooms a clicked small place only to that smaller size, its name over its neighbour’s', () => {
    const places = [label('Lux', 100, 100, 1), label('Next', 103, 100, 900)];
    assert.deepEqual(labelZoom(places, { ...VIEW, key: 'Lux', firstMinArea: 25 }), { k: 5, x: -300, y: -350 }, '1px² × 25');
    assert.equal(labelZoom(places, { ...VIEW, key: 'Lux' }).k, 10, 'the usual size: 100px²');
  });
});

// A clicked country zooms in only until its name shows.
describe('labelZoom', () => {
  // At zoom 1: "Big" has room for a name from zoom 1, "Tiny" (25px²) needs zoom 2 (area × 4 = 100).
  const PLACES = [label('Big', 100, 100, 400), label('Tiny', 300, 200, 25), label('Dot', 50, 50, 0), label('Nameless', 200, 200, 400, null)];
  test('the place comes to the middle at the least zoom that has room for its name', () => {
    assert.deepEqual(labelZoom(PLACES, { ...VIEW, key: 'Big' }), { k: 1, x: 100, y: 50 });
    assert.deepEqual(labelZoom(PLACES, { ...VIEW, key: 'Tiny' }), { k: 2, x: -400, y: -250 }, 'zoom 2: 25px² × 4');
  });
  test('never below the zoom names start at, and never out from the present zoom', () => {
    assert.equal(labelZoom(PLACES, { ...VIEW, key: 'Big', minZoom: 2.5 }).k, 2.5);
    assert.equal(labelZoom(PLACES, { ...VIEW, key: 'Big', minZoom: 2.5, from: 6 }).k, 6);
  });
  test('zooms on, step by step, while its name does not fit the view', () => {
    // The map cannot pan: "Edge" is 5px from the left, and its 40px name fits from 20px on (zoom 4).
    const fit = labelZoom([label('Edge', 5, 30, 400)], { ...VIEW, key: 'Edge', step: 2, clamp: () => [0, 0] });
    assert.deepEqual(fit, { k: 4, x: 0, y: 0 }, '1 and 2 are cut off by the edge');
  });
  test('the pan limits may keep the place off the middle: the name must fit where it lands', () => {
    // The map allows no panning at all: at zoom 1 "Edge" stays 5px from the left, its name cut off.
    const places = [label('Edge', 5, 100, 400)];
    assert.equal(labelZoom(places, { ...VIEW, key: 'Edge', max: 1, clamp: () => [0, 0] }), null);
    assert.deepEqual(labelZoom(places, { ...VIEW, key: 'Edge', max: 1 }), { k: 1, x: 195, y: 50 }, 'free to pan: centred');
  });
  test('null for a place with no area or no name, and when no zoom up to the limit shows it', () => {
    assert.equal(labelZoom(PLACES, { ...VIEW, key: 'Dot' }), null);
    assert.equal(labelZoom(PLACES, { ...VIEW, key: 'Nameless' }), null);
    assert.equal(labelZoom(PLACES, { ...VIEW, key: 'Unknown' }), null);
    assert.equal(labelZoom(PLACES, { ...VIEW, key: 'Tiny', max: 1.5 }), null, 'needs zoom 2');
  });
});
