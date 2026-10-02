// The context of each war (pure): what the war card says beside UCDP's figures, from a context
// source's articles (Wikipedia). Published as risk/wars.json; never a level or a change.
//
// Per conflict (UCDP key), from its article (config `articles`):
//   title, url, extract, start, map, revised   as the article gives them
//   sides    { a, b }: for UCDP's side A and side B, the other countries Wikipedia names on that
//            side (`with`) and the countries it says back it (`backers`). Only names that are
//            countries in the place registry are kept, so the infobox's sub-units and notes
//            never reach the site. Wikipedia's sides are matched to UCDP's by the countries and
//            groups they share (Wikipedia may list them the other way round, or add a third side).
//   names    UCDP's short names spelled out from the infobox's links: { "RSF": "Rapid Support Forces" }
//
// A war without an article only warns: the card then shows UCDP's sides alone.

import { nameKey } from './text.mjs';

/**
 * @param conflict  the published conflict figures (lib/conflict.mjs): conflicts with their sides, quiet
 * @param context   the stored articles: { fetchedAt, articles: { title: article } }
 * @param config    config/sources/<id>.json (articles, places, licence, links, minWarDeaths)
 * @param index     placeIndex() of the registry
 * @returns { published, warnings }
 */
export function warsContext(sourceId, { conflict, context, config, index }) {
  const warnings = [];
  const placeOf = (name) => config.places?.[name]
    ?? (/^[A-Z]{3}$/.test(name) ? index.byCode.get(name) : undefined)
    ?? index.byKey.get(nameKey(name))
    ?? index.byKey.get(nameKey(name.replace(/^(the )?(government|republic|kingdom|state|federation) of /i, '')));
  const quiet = new Map((conflict.quiet ?? []).map(q => [q.key, q]));
  const out = {};
  for (const [key, title] of Object.entries(config.articles)) {
    const c = conflict.conflicts[key];
    if (!c && !quiet.has(key)) continue;   // not active now: nothing to show it on
    const a = context?.articles?.[title];
    if (!a) {
      warnings.push(`[${sourceId}] ${key}: no copy of "${title}" yet`);
      continue;
    }
    out[key] = {
      title: a.title, url: a.url, extract: a.extract, start: a.start ?? null,
      map: a.image?.map ? `https://en.wikipedia.org/wiki/File:${encodeURIComponent(a.image.file.replaceAll(' ', '_'))}` : null,
      revised: a.revised ?? null,
      sides: c ? matchSides(c.sides, a.sides ?? [], placeOf, a.names ?? {}) : null,
      names: c ? spelled(c.sides, a.names ?? {}) : {},
    };
  }
  const missing = Object.entries(conflict.conflicts).filter(([key, c]) => c.deaths12 >= config.minWarDeaths && !config.articles[key]);
  if (missing.length) warnings.push(`[${sourceId}] wars without an article in config/sources/${sourceId}.json: ${missing.map(([key, c]) => `${key} (${c.name ?? 'unnamed'})`).join(', ')}`);
  return {
    published: {
      asOf: context?.fetchedAt ?? null, source: sourceId, licence: config.licence, links: { home: config.links?.home, terms: config.links?.terms },
      conflicts: out,
    },
    warnings,
  };
}

/**
 * UCDP's sides with Wikipedia's countries: { a: { with, backers }, b: { with, backers } }.
 * Each Wikipedia side is scored against UCDP's: 2 for each country both name, 1 for each group
 * (by name or the infobox's short name). The best pair of Wikipedia sides wins; with no match
 * at all, Wikipedia adds nothing.
 */
export function matchSides(ucdp, wiki, placeOf, shortNames = {}) {
  const uc = ['a', 'b'].map(s => ({
    places: new Set(ucdp[s].map(x => x.place).filter(Boolean)),
    groups: ucdp[s].filter(x => x.name && !x.place).map(x => nameKey(x.name)),
  }));
  const ws = wiki.map(w => {
    const fighters = w.fighters.map(n => ({ n, key: nameKey(n), place: placeOf(n) }));
    return {
      fighters,
      backers: w.backers.map(placeOf).filter(Boolean),
      keys: new Set(fighters.flatMap(f => [f.key, ...(shortNames[f.n] ? [nameKey(shortNames[f.n])] : [])])),
    };
  });
  const score = (w, u) => [...u.places].filter(p => w.fighters.some(f => f.place === p)).length * 2
    + u.groups.filter(g => w.keys.has(g)).length;
  let best = null;
  for (let i = 0; i < ws.length; i++) {
    for (let j = -1; j < ws.length; j++) {
      if (i === j) continue;
      for (const [x, y] of [[i, j], [j, i]]) {
        const total = (x >= 0 ? score(ws[x], uc[0]) : 0) + (y >= 0 ? score(ws[y], uc[1]) : 0);
        if (total > (best?.total ?? 0)) best = { total, a: x, b: y };
      }
    }
  }
  const empty = { with: [], backers: [] };
  if (!best) return { a: empty, b: empty };
  const ucdpPlaces = new Set([...uc[0].places, ...uc[1].places]);
  const taken = new Set(ucdpPlaces);
  const side = (k) => {
    if (k < 0) return empty;
    const allies = [...new Set(ws[k].fighters.map(f => f.place).filter(p => p && !taken.has(p)))];
    allies.forEach(p => taken.add(p));
    const backers = [...new Set(ws[k].backers.filter(p => !taken.has(p)))];
    return { with: allies, backers };
  };
  const a = side(best.a);
  const b = side(best.b);
  // A backer named on both sides (Wikipedia's lists are long) is left out of both.
  const both = new Set(a.backers.filter(p => b.backers.includes(p)));
  return { a: { ...a, backers: a.backers.filter(p => !both.has(p) && !b.with.includes(p)) }, b: { ...b, backers: b.backers.filter(p => !both.has(p) && !a.with.includes(p)) } };
}

/** UCDP's group names that the infobox links spell out: { "RSF": "Rapid Support Forces" }. */
function spelled(sides, shortNames) {
  const out = {};
  for (const x of [...sides.a, ...sides.b]) {
    if (!x.name || x.place) continue;
    const full = shortNames[x.name];
    if (full && nameKey(full) !== nameKey(x.name)) out[x.name] = full;
  }
  return out;
}
