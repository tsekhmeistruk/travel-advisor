import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIndex, parsePage, levelFromAlerts, LEVEL_BY_ALERT } from '../../../scripts/providers/uk/parse.mjs';

// Real GOV.UK Content API responses, trimmed: 12 destinations of the index, and four pages.
const fixture = (f) => JSON.parse(readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8'));
const INDEX = fixture('uk-index.json');
const PAGES = fixture('uk-pages.json');

describe('parseIndex', () => {
  test('lists every destination with its name, page and last-published time, sorted by name', () => {
    const list = parseIndex(INDEX);
    assert.equal(list.length, 12);
    assert.deepEqual(list.map(d => d.name), [...list.map(d => d.name)].sort((a, b) => a.localeCompare(b)));
    const mexico = list.find(d => d.name === 'Mexico');
    assert.equal(mexico.apiUrl, 'https://www.gov.uk/api/content/foreign-travel-advice/mexico');
    assert.equal(mexico.url, 'https://www.gov.uk/foreign-travel-advice/mexico');
    assert.match(mexico.stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
    assert.ok(list.some(d => d.name === 'Bonaire/St Eustatius/Saba'), 'names that need aliases are kept as they are');
  });
  test('rejects an index without destinations, or a destination without name, page or date', () => {
    assert.throws(() => parseIndex({}), /no list of destinations/);
    assert.throws(() => parseIndex({ links: { children: [{ details: { country: { name: 'X' } } }] } }), /without name, page or date/);
  });
});

describe('levels from the FCDO warnings', () => {
  test('real pages: whole country, parts, several warnings, none', () => {
    assert.deepEqual(parsePage(PAGES.afghanistan), { level: 4, regional: false, alerts: ['avoid_all_travel_to_whole_country'] });
    assert.deepEqual(parsePage(PAGES.mexico), { level: 2, regional: true, alerts: ['avoid_all_but_essential_travel_to_parts'] });
    assert.deepEqual(parsePage(PAGES.ukraine), { level: 3, regional: true, alerts: ['avoid_all_but_essential_travel_to_parts', 'avoid_all_travel_to_parts'] }, 'the most severe warning sets the level');
    assert.deepEqual(parsePage(PAGES.france), { level: 1, regional: false, alerts: [] });
  });
  test('maps every known warning; essential-only for the whole country is level 3', () => {
    assert.deepEqual(Object.values(LEVEL_BY_ALERT).sort(), [2, 3, 3, 4]);
    assert.deepEqual(levelFromAlerts(['avoid_all_but_essential_travel_to_whole_country']), { level: 3, regional: false, alerts: ['avoid_all_but_essential_travel_to_whole_country'] });
    assert.equal(levelFromAlerts(['avoid_all_travel_to_whole_country', 'avoid_all_travel_to_parts']).regional, false, 'the whole country is already at the top');
  });
  test('an unknown warning or a page without warnings fails, so a new FCDO category is noticed', () => {
    assert.throws(() => levelFromAlerts(['avoid_space_travel']), /Unknown FCDO warning "avoid_space_travel"/);
    assert.throws(() => parsePage({ details: {} }), /no alert_status/);
  });
});
