// The map's characters (site/js/map/characters.js): every one has the groups the gaze and the
// acts move, so any of them can play every act.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTERS, DEFAULT_CHARACTER, character } from '../../../site/js/map/characters.js';

// What the CSS moves: the gaze's layers, and each act's part (see antics.js).
const GROUPS = ['mascot-bob', 'mascot-arm', 'mascot-head', 'mascot-ears', 'mascot-muzzle', 'mascot-nose', 'mascot-mouth', 'mascot-grin', 'mascot-face', 'mascot-glasses'];
const en = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../../site/i18n/en.json', import.meta.url), 'utf8'));

describe('characters', () => {
  test('the capybara and the goose, the capybara first', () => {
    assert.deepEqual(CHARACTERS.map(c => c.id), ['capybara', 'goose']);
    assert.equal(DEFAULT_CHARACTER, 'capybara');
  });

  for (const c of CHARACTERS) {
    test(`${c.id}: has every group the gaze and the acts move, two eyes, an icon and a name`, () => {
      for (const g of GROUPS) assert.equal(c.drawing.split(`class="${g}"`).length - 1, 1, `one ${g}`);
      assert.equal(c.drawing.split('class="mascot-eye"').length - 1, 2);
      assert.equal(c.drawing.split('class="mascot-pupil"').length - 1, 2);
      assert.ok(!/\$\{|undefined|NaN/.test(c.drawing + c.icon), 'every colour and number filled in');
      assert.ok(c.eyes > 60 && c.eyes < 120, `eyes ${c.eyes} units above its feet`);
      assert.match(c.icon, /^<(rect|ellipse|circle|path)/);
      assert.ok(en.mascot[c.id], `named in the translations: mascot.${c.id}`);
    });
  }

  test('character(id) finds one; an unknown id (an old setting) is the first', () => {
    assert.equal(character('goose').id, 'goose');
    assert.equal(character('dragon').id, 'capybara');
    assert.equal(character(undefined).id, 'capybara');
  });
});
