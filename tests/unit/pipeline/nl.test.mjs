import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { levelFromSummary, parseAdvisories, listDocuments, LEVEL_BY_COLOUR } from '../../../scripts/providers/nl/parse.mjs';

const fixture = (f) => readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8');
const docs = listDocuments(JSON.parse(fixture('netherlands-list.json')));
const byCode = (code) => docs.find(d => d.isocode === code);

describe('levelFromSummary (real Dutch summaries)', () => {
  test('maps the four colours to levels 1–4', () => {
    assert.deepEqual(LEVEL_BY_COLOUR, { groen: 1, geel: 2, oranje: 3, rood: 4 });
  });

  test('rule "single": one colour for the whole country (Spain)', () => {
    assert.deepEqual(levelFromSummary(byCode('ESP').introduction), { level: 1, regional: false, rule: 'single' });
  });

  test('rule "rest": the baseline colour "for the rest of" the country (Iceland, Montserrat)', () => {
    assert.deepEqual(levelFromSummary(byCode('ISL').introduction), { level: 1, regional: true, rule: 'rest' });
    assert.deepEqual(levelFromSummary(byCode('MSR').introduction), { level: 1, regional: true, rule: 'rest' });
  });

  test('regression: a typo in the source ("Vor de rest van Marokko") still finds the baseline', () => {
    const morocco = '<p>De kleurcode van het reisadvies is rood voor het grensgebied tussen Marokko en Mauritanië. '
      + 'Kleurcode oranje geldt voor het grensgebied tussen Marokko en Algerije. Vor de rest van Marokko geldt kleurcode geel.</p>';
    assert.deepEqual(levelFromSummary(morocco), { level: 2, regional: true, rule: 'rest' });
  });

  test('rule "country": an explicit whole-country statement (UAE, Somalia, Burkina Faso)', () => {
    assert.deepEqual(levelFromSummary(byCode('ARE').introduction), { level: 2, regional: true, rule: 'country' }, 'UAE: yellow, red only for two islands');
    assert.deepEqual(levelFromSummary(byCode('SOM').introduction), { level: 4, regional: true, rule: 'country' }, 'Somalia: red (except two cities)');
    assert.deepEqual(levelFromSummary(byCode('BFA').introduction), { level: 4, regional: true, rule: 'country' }, 'Burkina Faso: mostly red');
  });

  test('a regional colour ("is oranje voor het zuiden") is not mistaken for the country colour', () => {
    const text = 'De kleurcode van het reisadvies voor Landia is oranje voor het zuiden. Elders geldt kleurcode geel.';
    assert.equal(levelFromSummary(text).rule, 'severest');
  });

  test('rule "severest": otherwise the most severe colour mentioned (Iraq, Palestinian territories)', () => {
    assert.deepEqual(levelFromSummary(byCode('IRQ').introduction), { level: 4, regional: true, rule: 'severest' });
    assert.deepEqual(levelFromSummary(byCode('PSE').introduction), { level: 4, regional: true, rule: 'severest' });
  });

  test('no colour at all gives null', () => {
    assert.equal(levelFromSummary('<p>Lees meer over reizen.</p>'), null);
    assert.equal(levelFromSummary(undefined), null);
  });
});

describe('parseAdvisories', () => {
  const { entries, rules, severest, unreadable } = parseAdvisories(docs);
  const get = (iso) => entries.find(e => e.iso === iso);

  test('reads every advisory of the real response, with counts per rule', () => {
    assert.equal(entries.length, docs.length);
    assert.deepEqual(unreadable, []);
    assert.deepEqual(rules, { single: 5, rest: 2, country: 3, severest: 2 });   // single: ESP, BQ-BO, XKX, SJM, CAN
    assert.deepEqual(severest.sort(), ['Irak', 'Palestijnse Gebieden']);
  });

  test('keeps the Dutch name, ISO code, UTC date and timestamp, and the official page', () => {
    const spain = get('ESP');
    assert.equal(spain.name, 'Spanje');
    assert.match(spain.updated, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(spain.stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(spain.url, 'https://www.nederlandwereldwijd.nl/reisadvies/spanje');
    assert.equal(spain.regional, undefined, 'regional is only set when true');
  });

  test('passes special codes through for the provider config to map (Kosovo, Bonaire, Svalbard)', () => {
    assert.deepEqual(['XKX', 'BQ-BO', 'SJM'].map(c => !!get(c)), [true, true, true]);
  });

  test('skips an advisory without a colour and reports it', () => {
    const r = parseAdvisories([...docs, { ...byCode('ESP'), location: 'Nergensland', isocode: 'XXX', introduction: '<p>Geen kleurcode.</p>' }]);
    assert.deepEqual(r.unreadable, ['Nergensland']);
  });

  test('rejects an advisory without a location, code or date', () => {
    assert.throws(() => parseAdvisories([{ ...byCode('ESP'), isocode: undefined }]), /without location, code or date/);
  });
});

describe('listDocuments', () => {
  test('accepts the plain array the API returns, and a wrapping object', () => {
    assert.equal(listDocuments([{ a: 1 }]).length, 1);
    assert.equal(listDocuments({ documents: [{ a: 1 }, { a: 2 }] }).length, 2);
  });
  test('rejects a response without a list', () => {
    assert.throws(() => listDocuments({ error: 'x' }), /no list of advisories/);
  });
});
