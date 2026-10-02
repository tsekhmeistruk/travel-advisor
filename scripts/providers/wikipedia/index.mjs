// Wikipedia: the context of each war for the Wars mode's war card (who is on each side, with
// which countries and backers, when it began, a short summary, a map). Never a level or a change.
//
// Source: en.wikipedia.org (no key; text CC BY-SA 4.0, credited and linked on the site). Each
// run reads the articles listed in config/sources/wikipedia.json (`articles`: UCDP conflict
// key -> title), one after the other, as Wikimedia's API etiquette asks: the REST summary, the
// lead section's wikitext and, when the infobox is a template of its own, that template. An
// article that fails keeps its last copy, so one renamed page doesn't empty the rest. Parsing
// is in ./parse.mjs; the build (lib/wars.mjs) matches the sides to UCDP's.

import { findInfobox, params, sides, names, startDate, summary } from './parse.mjs';

const API = 'https://en.wikipedia.org/w/api.php';
const REST = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
// Wikimedia asks for a User-Agent that says who is calling and how to reach them.
const HEADERS = { 'User-Agent': 'RiskMonitor/1.0 (https://github.com/tsekhmeistruk/travel-advisor)', Accept: 'application/json' };

export default {
  id: 'wikipedia',
  kind: 'context',
  source: 'https://en.wikipedia.org/',

  /**
   * @param previous  the stored articles ({ fetchedAt, articles }) or null
   * @param sleep     injectable for tests
   * @returns { data: { fetchedAt, articles: { title: article } }, stats }
   */
  async fetch({ log, previous, now, config, sleep = defaultSleep }) {
    const titles = [...new Set(Object.values(config.articles))].sort();
    const articles = {};
    const failed = [];
    const noInfobox = [];
    for (const title of titles) {
      try {
        const a = await article(log, title, sleep);
        if (!a.sides.length) noInfobox.push(title);
        articles[title] = { ...a, fetchedAt: now.toISOString() };
      } catch (err) {
        failed.push(title);
        log.warn(`Wikipedia "${title}": ${err.message}${previous?.articles?.[title] ? '; its last copy is kept' : ''}`);
        if (previous?.articles?.[title]) articles[title] = previous.articles[title];
      }
    }
    if (failed.length === titles.length) throw new Error(`every Wikipedia article failed (${failed.length})`);
    return {
      data: { fetchedAt: now.toISOString(), articles },
      stats: { articles: titles.length, fetched: titles.length - failed.length, failed, noInfobox },
    };
  },
};

/** One article: its summary, start, sides and the names its infobox links. */
async function article(log, title, sleep) {
  const s = summary(JSON.parse(await get(log, 'summary', `${REST}${encodeURIComponent(title.replaceAll(' ', '_'))}`, sleep)));
  let box = findInfobox(await wikitext(log, 'lead', title, sleep, '&section=0'));
  if (box?.template) box = findInfobox(await wikitext(log, 'infobox', box.template, sleep));
  const p = box?.body ? params(box.body) : {};
  return { ...s, start: startDate(p.date), sides: sides(p), names: names(p) };
}

async function wikitext(log, call, page, sleep, extra = '') {
  const url = `${API}?action=parse&format=json&formatversion=2&redirects=1&prop=wikitext${extra}&page=${encodeURIComponent(page)}`;
  const json = JSON.parse(await get(log, call, url, sleep));
  if (json.error) throw new Error(`${page}: ${json.error.info ?? json.error.code}`);
  if (typeof json.parse?.wikitext !== 'string') throw new Error(`${page}: no wikitext`);
  return json.parse.wikitext;
}

// A 404 is an answer (the page is gone or renamed): no retry.
async function get(log, call, url, sleep, attempt = 1) {
  const res = await log.request(call, url, { headers: HEADERS, signal: AbortSignal.timeout(30000) }, { detail: false }).catch(err => ({ error: err }));
  if (res.status === 404) throw new Error('HTTP 404 (page not found)');
  if (res.ok) return res.body;
  if (attempt >= 3) throw new Error(`failed after ${attempt} attempts: ${res.error?.message ?? `HTTP ${res.status}`}`);
  await sleep(attempt * 5000);
  return get(log, call, url, sleep, attempt + 1);
}

function defaultSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
