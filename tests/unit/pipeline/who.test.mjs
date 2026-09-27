import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNotices, parseNotice, countriesFromTitle, SCHEME, NOTICE_URL } from '../../../scripts/providers/who/parse.mjs';

// A real response of the Disease Outbreak News API: the latest 40 notices, selected fields.
const FIXTURE = readFileSync(new URL('../../fixtures/who-don.json', import.meta.url), 'utf8');

describe('parseNotices on a real response', () => {
  const notices = parseNotices(FIXTURE);

  test('reads every notice as one event with a unique id, its date and its link', () => {
    assert.equal(notices.length, 40);
    assert.equal(new Set(notices.map(n => n.id)).size, 40);
    const n = notices.find(x => x.id === 'who:DON:2026-DON618');
    assert.equal(n.code, 'DON');
    assert.deepEqual(n.native, { scheme: SCHEME, value: 'notice' });
    assert.equal(n.startedAt, '2026-09-25T15:30:18.000Z');
    assert.equal(n.toDate, n.startedAt, 'a notice is one date');
    assert.equal(n.current, false);
    assert.equal(n.url, `${NOTICE_URL}2026-DON618`);
    assert.equal(n.country, 'Democratic Republic of the Congo');
  });

  test('keeps only the title, date and link: no WHO text', () => {
    for (const n of notices) assert.deepEqual(Object.keys(n).sort(), ['code', 'country', 'current', 'id', 'iso3', 'name', 'native', 'startedAt', 'toDate', 'url']);
  });

  test('finds countries in most titles, and none for global or regional notices', () => {
    assert.equal(notices.filter(n => n.country).length, 26, 'the other 14 are global, regional or multi-country');
    assert.ok(notices.some(n => /Global|Multi/.test(n.name) && n.country === undefined));
    assert.ok(notices.some(n => n.name.endsWith('disease- Ethiopia') && n.country === 'Ethiopia'));
  });
});

describe('countriesFromTitle', () => {
  test('takes the names after the last " - " or ", ", split at "&"', () => {
    assert.deepEqual(countriesFromTitle('Nipah virus disease - India'), ['India']);
    assert.deepEqual(countriesFromTitle('Ebola disease caused by Bundibugyo virus, Democratic Republic of the Congo & Uganda'), ['Democratic Republic of the Congo', 'Uganda']);
    assert.deepEqual(countriesFromTitle('Ebola disease – Democratic Republic of the Congo'), ['Democratic Republic of the Congo']);
    assert.deepEqual(countriesFromTitle('Rift Valley fever - Mauritania and Senegal'), ['Mauritania and Senegal'], '" and " is split in the build, if needed');
    assert.deepEqual(countriesFromTitle('Marburg virus disease- Ethiopia'), ['Ethiopia'], 'WHO sometimes leaves out the space before the dash');
  });
  test('keeps hyphenated names whole', () => {
    assert.deepEqual(countriesFromTitle('Dengue - Timor-Leste'), ['Timor-Leste']);
    assert.deepEqual(countriesFromTitle('Guinea-Bissau cholera'), []);
  });
  test('names no country for the world, a region, or several unnamed places', () => {
    for (const t of ['Yellow fever - Global', 'Avian influenza - Global situation', 'Mpox - African Region (AFRO)', 'Dengue - Region of the Americas',
      'Hantavirus outbreak linked to cruise ship travel, Multi-locations', 'Hantavirus cluster, Multi-country', 'Influenza in the Northern Hemisphere, update']) {
      assert.deepEqual(countriesFromTitle(t), [], t);
    }
  });
});

describe('parseNotice', () => {
  const base = { DonId: '2026-DON1', Title: 'Cholera - Chad', PublicationDate: '2026-09-01T10:00:00Z' };
  test('uses the override title when WHO sets one', () => {
    assert.equal(parseNotice({ ...base, UseOverrideTitle: true, OverrideTitle: 'Cholera - Niger' }).country, 'Niger');
    assert.equal(parseNotice({ ...base, UseOverrideTitle: false, OverrideTitle: 'Cholera - Niger' }).country, 'Chad');
  });
  test('rejects a notice without id, title or a valid date, and a body that is not a list', () => {
    assert.throws(() => parseNotice({ ...base, DonId: '' }), /without id/);
    assert.throws(() => parseNotice({ ...base, Title: ' ' }), /without id/);
    assert.throws(() => parseNotice({ ...base, PublicationDate: 'soon' }), /is not a date/);
    assert.throws(() => parseNotice(null), /without id/);
    assert.throws(() => parseNotices('<html>'), /not JSON/);
    assert.throws(() => parseNotices('{"value":null}'), /no list of notices/);
  });
});
