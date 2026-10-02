// Wikipedia context (scripts/providers/wikipedia/, scripts/lib/wars.mjs): reading the war
// infoboxes and summaries of real articles (tests/fixtures/wikipedia.json, Oct 2, 2026, lead
// wikitext cut to the infobox), the fetcher, and matching Wikipedia's sides to UCDP's.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findInfobox, params, side, sides, names, startDate, summary, plain } from '../../../scripts/providers/wikipedia/parse.mjs';
import wikipedia from '../../../scripts/providers/wikipedia/index.mjs';
import { warsContext, matchSides } from '../../../scripts/lib/wars.mjs';
import { placeIndex } from '../../../scripts/lib/build.mjs';

const FIXTURE = JSON.parse(readFileSync(new URL('../../fixtures/wikipedia.json', import.meta.url), 'utf8'));
const PLACES = JSON.parse(readFileSync(new URL('../../../config/places.json', import.meta.url), 'utf8'));
const CONFIG = JSON.parse(readFileSync(new URL('../../../config/sources/wikipedia.json', import.meta.url), 'utf8'));
const index = placeIndex(PLACES);
const lead = (title) => JSON.parse(FIXTURE[`lead ${title}`]).parse.wikitext;
const page = (name) => JSON.parse(FIXTURE[`page ${name}`]).parse.wikitext;
const infobox = (wikitext) => params(findInfobox(wikitext).body);
const UKRAINE = 'Russo-Ukrainian war (2022–present)';
const SUDAN = 'Sudanese civil war (2023–present)';
const LEBANON = '2026 Lebanon war';
const IRAN = '2026 Iran war';
const MALI = 'Mali War';
const VENEZUELA = '2026 United States intervention in Venezuela';

describe('the infobox of a war', () => {
  test('found inline ({{#invoke:Infobox military conflict}} or {{Infobox military conflict}}), in a template of its own, or not at all', () => {
    assert.ok(findInfobox(lead(UKRAINE)).body.includes('combatant1'), '#invoke form');
    assert.ok(findInfobox(lead(SUDAN)).body.includes('combatant2'));
    assert.deepEqual(findInfobox(lead(IRAN)), { template: 'Template:2026 Iran war infobox' });
    assert.ok(findInfobox(page('Template:2026 Iran war infobox')).body.includes('combatant1'));
    assert.equal(findInfobox(lead(VENEZUELA)), null, 'a military operation\'s infobox has no sides');
  });

  test('Russia, Belarus and North Korea against Ukraine', () => {
    const s = sides(infobox(lead(UKRAINE)));
    assert.equal(s.length, 2);
    assert.deepEqual(s[0].fighters, ['Russia', 'Belarus', 'North Korea']);
    assert.deepEqual(s[1].fighters, ['Ukraine']);
  });

  test('Sudan: every level of the list, without remarks; what ended is left out; the short names spelled out', () => {
    const p = infobox(lead(SUDAN));
    const [government, rsf] = sides(p);
    assert.ok(government.fighters.includes('Government of Sudan') && government.fighters.includes('Egypt'), government.fighters.join(', '));
    assert.ok(rsf.fighters.includes('Government of Peace and Unity') && rsf.fighters.includes('RSF'), rsf.fighters.join(', '));
    assert.ok(!rsf.fighters.includes('Wagner Group'), 'Wagner Group (until early 2024)');
    assert.ok(!government.fighters.includes('Ukraine'), 'Ukraine (until 2024)');
    assert.ok([...government.fighters, ...rsf.fighters].every(n => !/[()]/.test(n)), 'no brackets left');
    const n = names(p);
    assert.equal(n.RSF, 'Rapid Support Forces');
    assert.equal(n.SFA, 'Sudan Founding Alliance');
    assert.equal(startDate(p.date), '2023-04');
  });

  test('Mali: only the current period counts, its backers after "Supported by"', () => {
    const [state, ...rest] = sides(infobox(lead(MALI)));
    assert.ok(state.fighters.includes('Mali') && state.fighters.includes('Russia'), state.fighters.join(', '));
    assert.ok(!state.fighters.includes('France') && !state.backers.includes('France'), 'France fought in 2013–2023 only');
    assert.ok(state.backers.includes('Turkey'), state.backers.join(', '));
    assert.ok(rest.length >= 1);
  });

  test('a country by its code ({{IRN}}), and a third side (Lebanon)', () => {
    const iran = sides(infobox(page('Template:2026 Iran war infobox')));
    assert.ok(iran[1].fighters.includes('IRN'), iran[1].fighters.join(', '));
    assert.ok(iran[0].fighters.includes('United States') && iran[0].fighters.includes('Israel'));
    const lebanon = sides(infobox(lead(LEBANON)));
    assert.equal(lebanon.length, 3);
    assert.ok(lebanon[0].fighters.includes('Hezbollah') && lebanon[1].fighters.includes('Israel') && lebanon[2].fighters.includes('Lebanon'));
    assert.equal(startDate(infobox(lead(LEBANON)).date), '2026-03', '{{start date|2026|3|2}}');
  });

  test('plain text: flags give their country (or their name=), lists become items, notes and references go', () => {
    assert.equal(plain('{{flag|Yemen|name=Republic of Yemen}}'), 'Republic of Yemen');
    assert.equal(plain('{{#invoke:flag||Russia}}<ref name="x">{{cite web|url=a}}</ref>'), 'Russia');
    assert.equal(plain("'''[[Sudanese Armed Forces|SAF]]'''{{efn|a note}}"), 'SAF');
    assert.equal(plain('{{ubl|[[Hamas]]|PIJ}}'), '\n* Hamas\n* PIJ');
    assert.equal(plain('{{Collapsible list|title=[[Yemen]]|** [[Yemeni Armed Forces]]}}'), '\n* Yemen\n** Yemeni Armed Forces');
    assert.equal(plain('[[File:Flag.svg|20px]] Chad<br />Niger'), ' Chad\nNiger');
    assert.equal(plain('{{small|(from 2025)}}'), ' ((from 2025))');
  });

  test('a side: headings, notes, hedges and periods are not fighters', () => {
    const s = side('* [[Somalia]]\n* Eritrea {{small|(alleged)}}\n* Attacked by Israel\n* Training:\n* 2012–2013\n* France\n* 2023–present\n* Chad (2013 only)\n* Mali\n* \'\'\'Supported by:\'\'\'\n* {{flag|Turkey}}');
    assert.deepEqual(s, { fighters: ['Somalia', 'Mali'], backers: ['Turkey'] });
    assert.deepEqual(side('{{flag|Israel}}<br>{{flag|United States}}'), { fighters: ['Israel', 'United States'], backers: [] });
    assert.deepEqual(side('Supported by: {{flag|Iran}}'), { fighters: [], backers: ['Iran'] }, 'backers on the same line');
  });

  test('when a war began: a day, a month or a year', () => {
    assert.equal(startDate('15 April 2023 – present'), '2023-04');
    assert.equal(startDate('February 24, 2022 – present'), '2022-02');
    assert.equal(startDate('2011 – present'), '2011');
    assert.equal(startDate('1 January 2012 (2012-01-01) – 2 May 2015'), '2012-01');
    assert.equal(startDate(''), null);
    assert.equal(startDate('ongoing'), null);
  });
});

describe('the summary', () => {
  test('title, link, extract, revision and the lead image (a map when it is an SVG)', () => {
    const s = summary(JSON.parse(FIXTURE[`summary ${SUDAN}`]));
    assert.equal(s.title, SUDAN);
    assert.match(s.url, /^https:\/\/en\.wikipedia\.org\/wiki\/Sudanese_civil_war/);
    assert.ok(s.extract.length > 100 && /Sudan/.test(s.extract));
    assert.match(s.revised, /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual(s.image, { file: 'War_in_Sudan_(2023).svg', map: true });
    assert.equal(summary(JSON.parse(FIXTURE[`summary ${VENEZUELA}`])).image.map, false, 'a photo');
    assert.equal(summary({ title: 'X', extract: 'Y' }).image, null);
    assert.throws(() => summary({ type: 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found' }), /not a page summary/);
  });
});

describe('Wikipedia fetcher', () => {
  const NOW = new Date('2026-10-02T12:00:00Z');
  const config = { ...CONFIG, articles: { '1:13243': UKRAINE, '1:16905': IRAN, '1:309': SUDAN, '1:11347': MALI } };
  const titleOf = (url) => {
    const u = new URL(url);
    return u.searchParams.get('page') ?? decodeURIComponent(u.pathname.split('/').pop()).replaceAll('_', ' ');
  };
  const fakeLog = (respond) => {
    const log = { warnings: [], requests: [], warn: (m) => log.warnings.push(m) };
    log.request = async (call, url, init, opts) => {
      log.requests.push({ call, url, init, opts });
      const r = respond(call, titleOf(url));
      if (r instanceof Error) throw r;
      return { status: r.status ?? 200, ok: (r.status ?? 200) < 400, body: r.body ?? '' };
    };
    return log;
  };
  const real = (call, title) => {
    const key = call === 'summary' ? `summary ${title}` : call === 'lead' ? `lead ${title}` : `page ${title}`;
    return FIXTURE[key] ? { body: FIXTURE[key] } : { status: 404 };
  };

  test('reads each article once: its summary, the lead\'s infobox, and the infobox template when there is one', async () => {
    const log = fakeLog(real);
    const { data, stats } = await wikipedia.fetch({ log, previous: null, now: NOW, config });
    assert.equal(wikipedia.kind, 'context');
    assert.deepEqual(Object.keys(data.articles).sort(), [IRAN, MALI, UKRAINE, SUDAN].sort());
    assert.deepEqual(log.requests.filter(r => r.call === 'infobox').map(r => titleOf(r.url)), ['Template:2026 Iran war infobox']);
    assert.ok(log.requests.every(r => /^RiskMonitor\/1\.0 \(https:\/\/github\.com\//.test(r.init.headers['User-Agent'])), 'Wikimedia asks for a User-Agent that says who calls');
    const sudan = data.articles[SUDAN];
    assert.equal(sudan.fetchedAt, NOW.toISOString());
    assert.equal(sudan.start, '2023-04');
    assert.equal(sudan.names.RSF, 'Rapid Support Forces');
    assert.ok(data.articles[IRAN].sides[1].fighters.includes('IRN'));
    assert.deepEqual([stats.articles, stats.fetched, stats.failed, stats.noInfobox], [4, 4, [], []]);
  });

  test('an article that fails keeps its last copy; a 404 is not retried, other errors are; all failing is an error', async () => {
    const previous = { fetchedAt: '2026-09-25T00:00:00.000Z', articles: { [MALI]: { title: MALI, fetchedAt: '2026-09-25T00:00:00.000Z' } } };
    const waits = [];
    const sleep = async (ms) => { waits.push(ms); };
    let flaky = 0;
    const log = fakeLog((call, title) => {
      if (title === MALI) return { status: 404 };
      if (title === SUDAN && call === 'summary' && flaky++ < 2) return { status: 503 };
      return real(call, title);
    });
    const { data, stats } = await wikipedia.fetch({ log, previous, now: NOW, config, sleep });
    assert.deepEqual(data.articles[MALI], previous.articles[MALI], 'the last copy');
    assert.equal(data.articles[SUDAN].start, '2023-04', 'retried, then read');
    assert.deepEqual(waits, [5000, 10000]);
    assert.deepEqual(stats.failed, [MALI]);
    assert.ok(log.warnings.some(w => w.includes(MALI) && /404.*last copy is kept/.test(w)));
    await assert.rejects(wikipedia.fetch({ log: fakeLog(() => ({ status: 500 })), previous: null, now: NOW, config, sleep }), /every Wikipedia article failed \(4\)/);
    const broken = fakeLog((call, title) => (call === 'lead' && title === SUDAN ? { body: JSON.stringify({ error: { code: 'missingtitle', info: 'The page you specified doesn\'t exist.' } }) } : real(call, title)));
    const r = await wikipedia.fetch({ log: broken, previous: null, now: NOW, config: { ...config, articles: { '1:309': SUDAN, '1:13243': UKRAINE } }, sleep });
    assert.deepEqual(Object.keys(r.data.articles), [UKRAINE], 'no last copy of Sudan to keep');
    assert.ok(broken.warnings.some(w => /doesn't exist/.test(w)));
  });

  test('an article without a war infobox is kept for its summary and counted', async () => {
    const { data, stats } = await wikipedia.fetch({ log: fakeLog(real), previous: null, now: NOW, config: { ...config, articles: { '1:164': VENEZUELA } } });
    assert.deepEqual(data.articles[VENEZUELA].sides, []);
    assert.deepEqual(stats.noInfobox, [VENEZUELA]);
  });
});

describe('the context of the wars (lib/wars.mjs)', () => {
  const article = (title) => {
    const box = findInfobox(lead(title));
    const p = box?.template ? params(findInfobox(page(box.template)).body) : box ? params(box.body) : {};
    return { ...summary(JSON.parse(FIXTURE[`summary ${title}`])), start: startDate(p.date), sides: sides(p), names: names(p) };
  };
  const context = { fetchedAt: '2026-10-02T12:00:00.000Z', articles: Object.fromEntries([UKRAINE, SUDAN, LEBANON, IRAN, VENEZUELA].map(t => [t, article(t)])) };
  const gov = (place, name, deaths = 100) => ({ name, place, deaths });
  const group = (name, deaths = 100) => ({ name, deaths });
  const conflict = {
    conflicts: {
      '1:13243': { name: 'Russia - Ukraine', deaths12: 97739, sides: { a: [gov('ru', 'Government of Russia (Soviet Union)')], b: [gov('ua', 'Government of Ukraine')] } },
      '1:309': { name: 'Sudan: Government', deaths12: 5099, sides: { a: [gov('sd', 'Government of Sudan')], b: [group('SFA'), group('RSF')] } },
      '1:426': { name: 'Israel: Southern Lebanon', deaths12: 4498, sides: { a: [gov('il', 'Government of Israel')], b: [group('Hezbollah')] } },
      '1:16905': { name: 'Iran - Israel, United States of America', deaths12: 3791, sides: { a: [gov('ir', 'Government of Iran')], b: [gov('il', 'Government of Israel'), gov('us', 'Government of United States of America')] } },
      '1:777': { name: null, deaths12: 1500, sides: { a: [gov('ye', null)], b: [gov('ye', null)] } },
    },
    quiet: [{ key: '1:164', name: null, deaths: 300, lastDeaths: '2026-02', parties: ['us', 've'] }],
  };
  const config = { ...CONFIG, articles: { '1:13243': UKRAINE, '1:309': SUDAN, '1:426': LEBANON, '1:16905': IRAN, '1:164': VENEZUELA, '1:999': 'Gone war' } };
  const { published, warnings } = warsContext('wikipedia', { conflict, context, config, index });
  const c = published.conflicts;

  test('each active or quiet conflict with an article: its title, link, summary, start and map', () => {
    assert.deepEqual(Object.keys(c), ['1:13243', '1:309', '1:426', '1:16905', '1:164'], 'not 1:999: neither active nor quiet');
    assert.equal(published.asOf, context.fetchedAt);
    assert.equal(published.licence, 'CC BY-SA 4.0');
    assert.equal(c['1:309'].title, SUDAN);
    assert.equal(c['1:309'].map, 'https://en.wikipedia.org/wiki/File:War_in_Sudan_(2023).svg');
    assert.equal(c['1:164'].map, null, 'a photo is not a map');
    assert.equal(c['1:164'].sides, null, 'quiet: no sides to match');
    assert.equal(c['1:13243'].start, '2022-02');
  });

  test('Wikipedia\'s countries join UCDP\'s sides, whichever order Wikipedia lists them in', () => {
    assert.deepEqual(c['1:13243'].sides, { a: { with: ['by', 'kp'], backers: [] }, b: { with: [], backers: [] } }, 'Belarus and North Korea with Russia');
    assert.deepEqual(c['1:426'].sides.b.with, ['ir'], 'Lebanon: Wikipedia lists Hezbollah first; Iran is on its side');
    assert.deepEqual(c['1:426'].sides.a.with, [], 'and Lebanon (its third side) joins neither');
    assert.deepEqual(c['1:16905'].sides.b.with.slice(0, 3), ['sa', 'ae', 'kw'], 'Israel and the US, with the Gulf states');
    assert.deepEqual(c['1:16905'].sides.a.with, [], 'Iran ({{IRN}}) is UCDP\'s side A already');
    assert.deepEqual(c['1:309'].sides.a.with, ['eg'], 'Egypt with Sudan\'s government');
    assert.deepEqual(c['1:309'].names, { SFA: 'Sudan Founding Alliance', RSF: 'Rapid Support Forces' });
  });

  test('a war (1,000+ deaths) without an article, and an article not read yet, warn', () => {
    assert.ok(warnings.some(w => /wars without an article in config\/sources\/wikipedia\.json: 1:777 \(unnamed\)/.test(w)));
    const none = warsContext('wikipedia', { conflict, context: { fetchedAt: null, articles: {} }, config, index });
    assert.deepEqual(none.published.conflicts, {});
    assert.ok(none.warnings.some(w => /1:13243: no copy of "Russo-Ukrainian war/.test(w)));
  });

  test('matching: places count twice, groups once; no match adds nothing; a backer on both sides is dropped', () => {
    const placeOf = (n) => ({ Russia: 'ru', Ukraine: 'ua', Iran: 'ir', Turkey: 'tr', Qatar: 'qa', Egypt: 'eg' })[n];
    const ucdp = { a: [gov('ru', 'Government of Russia')], b: [group('Hamas')] };
    assert.deepEqual(matchSides(ucdp, [{ fighters: ['Hamas', 'Qatar'], backers: ['Iran', 'Turkey'] }, { fighters: ['Russia', 'Egypt'], backers: ['Turkey'] }], placeOf), {
      a: { with: ['eg'], backers: [] }, b: { with: ['qa'], backers: ['ir'] },
    });
    assert.deepEqual(matchSides(ucdp, [{ fighters: ['Nobody'], backers: ['Iran'] }], placeOf), { a: { with: [], backers: [] }, b: { with: [], backers: [] } });
    const aqap = { a: [gov('ye', 'Government of Yemen')], b: [group('al-Qaeda in the Arabian Peninsula')] };
    assert.deepEqual(matchSides(aqap, [{ fighters: ['AQAP'], backers: ['Iran'] }], placeOf, { AQAP: 'al-Qaeda in the Arabian Peninsula' }).b, { with: [], backers: ['ir'] }, 'by the name the infobox\'s short name links to');
  });
});
