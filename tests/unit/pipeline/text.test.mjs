import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, nameKey, plainText } from '../../../scripts/lib/text.mjs';

test('decodeEntities handles numeric, hex and named entities', () => {
  assert.equal(decodeEntities('C&#244;te d&#39;Ivoire'), "Côte d'Ivoire");
  assert.equal(decodeEntities('&#x2013;&ndash;&amp;'), '––&');
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
});

test('nameKey ignores accents, punctuation and case', () => {
  assert.equal(nameKey('Côte d’Ivoire'), nameKey('Cote d Ivoire'));
  assert.equal(nameKey('São Tomé and Príncipe'), nameKey('Sao Tome and Principe'));
  assert.notEqual(nameKey('Niger'), nameKey('Nigeria'));
});

test('plainText strips tags and collapses whitespace', () => {
  assert.equal(plainText('<b>Level</b>\n  <i>4</i>'), 'Level 4');
});
