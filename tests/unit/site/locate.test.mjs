// Where the visitor probably is, for the mascot's home (site/js/core/locate.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { guessPlace, browserZones } from '../../../site/js/core/locate.js';

const PLACES = [{ id: 'ca', iso2: 'CA' }, { id: 'ua', iso2: 'UA' }, { id: 'in', iso2: 'IN' }, { id: 'tw', iso2: 'TW' }, { id: 'gaza' }];
const ZONES = { CA: ['America/Toronto', 'America/Vancouver'], UA: ['Europe/Kyiv'], IN: ['Asia/Kolkata'], TW: ['Asia/Taipei'] };
const zonesOf = (iso2) => ZONES[iso2] ?? [];
const guess = (timeZone, languages = []) => guessPlace({ timeZone, languages, places: PLACES, zonesOf });

describe('guessPlace', () => {
  test('the country whose time zone the browser is in', () => {
    assert.equal(guess('America/Vancouver'), 'ca');
    assert.equal(guess('Europe/Kyiv', ['en-CA']), 'ua', 'the time zone tells more than the language');
  });
  test('a zone under its older name is the same zone', () => {
    assert.equal(guess('Europe/Kiev'), 'ua');
    assert.equal(guess('Asia/Calcutta'), 'in');
    assert.equal(guessPlace({ timeZone: 'Asia/Kolkata', places: PLACES, zonesOf: () => ['Asia/Calcutta'] }), 'ca', 'whichever side has the old name');
  });
  test('else the region of the languages, the preferred one first', () => {
    assert.equal(guess('UTC', ['en', 'uk-UA', 'en-CA']), 'ua');
    assert.equal(guess('Etc/Unknown', ['zh-Hant-TW']), 'tw', 'a script before the region');
    assert.equal(guess(undefined, ['en_CA']), 'ca');
  });
  test('null when nothing tells: no zone of a known country, no region', () => {
    assert.equal(guess('UTC', ['en', 'fr']), null);
    assert.equal(guess('Europe/Paris', ['en-FR']), null, 'a country that is not a place');
    assert.equal(guess(null, [null]), null);
    assert.equal(guessPlace({ timeZone: 'UTC', places: PLACES, zonesOf }), null);
  });
  test('browserZones() asks the browser, and is empty where it cannot say', () => {
    assert.ok(Array.isArray(browserZones('CA')));
    assert.deepEqual(browserZones('not a region'), []);
  });
});
