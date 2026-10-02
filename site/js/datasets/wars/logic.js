// Pure logic for the Wars mode (no DOM), shared by the view and unit tests. It reads the conflict
// figures that scripts/lib/conflict.mjs publishes (risk/conflict.json):
//   { through, bands: [1000, 100, 25], warDeaths, series: { months, wars, armedConflicts, deaths },
//     conflicts: { key: { name, sideA, sideB, deaths12, last, war, places, parties } },
//     places: { placeId: { deaths12, months[12], byType, trend, conflicts: [key], partyTo: [key] } } }

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** The months of the place figures (the 12 ending with `through`), oldest first. */
export function windowMonths(through, n = 12) {
  const [y, m] = through.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const k = y * 12 + (m - 1) - (n - 1 - i);
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;
  });
}

/**
 * The legend's bands, highest first: [{ level, min, max }] (max null: no upper end; the last,
 * Normal, is "fewer than" the lowest band).
 */
export function bandRows(bands) {
  const levels = [4, 3, 2];
  return [...bands.map((min, i) => ({ level: levels[i], min, max: i ? bands[i - 1] - 1 : null })), { level: 1, min: 0, max: bands.at(-1) - 1 }];
}

/** A conflict's display name: UCDP's, without the historical names in brackets ("Yemen (North Yemen)"); null if not named yet. */
export function conflictTitle(c) {
  return c.name ? c.name.replace(/\s*\([^)]*\)/g, '').replace(/\s+-\s+/g, ' – ') : null;
}

/**
 * A conflict's name for display, or, when UCDP hasn't named it yet, the government it involves
 * ("Nigeria: unnamed armed group") or where it is fought. `t` gives the texts (wars.unnamed, wars.unnamedNoParty).
 */
export function conflictName(c, t, placeName) {
  return conflictTitle(c) ?? (c.parties[0] ? t('unnamed', { place: placeName(c.parties[0]) }) : t('unnamedNoParty', { place: placeName(c.places[0]) }));
}

/**
 * The overview card: the war count now and how it moved, the latest month's deaths against the
 * month before, and the places escalating and calming (most deaths first).
 * @returns { through, wars, armed, yearAgo, spark: [{ month, wars }], deaths: { month, count, previous },
 *            escalating: [placeId], calming: [placeId] }
 */
export function overviewModel(conflict, { max = 3 } = {}) {
  const s = conflict.series;
  const spark = s.months.map((month, i) => ({ month, wars: s.wars[i] })).filter(p => p.wars != null);
  const at = (arr, back) => arr[arr.length - 1 - back] ?? null;
  const recent = (p) => sum(p.months.slice(-3));
  const before = (p) => sum(p.months.slice(-6, -3));
  const trending = (dir, key) => Object.entries(conflict.places).filter(([, p]) => p.trend === dir)
    .sort((a, b) => key(b[1]) - key(a[1]) || a[0].localeCompare(b[0])).slice(0, max).map(([id]) => id);
  return {
    through: conflict.through,
    wars: at(s.wars, 0),
    armed: at(s.armedConflicts, 0),
    yearAgo: at(s.wars, 12),
    spark,
    deaths: { month: conflict.through, count: at(s.deaths, 0), previous: at(s.deaths, 1) },
    escalating: trending('up', recent),
    calming: trending('down', before),
  };
}

/**
 * One place's card: its deaths by month, the band, the trend, the state-based conflicts fought
 * there and those it is a party to elsewhere, and its deaths by type (state-based, between armed
 * groups, against civilians). null when nothing is recorded.
 */
export function placeModel(conflict, placeId) {
  const p = conflict.places[placeId];
  if (!p) return null;
  const months = windowMonths(conflict.through, p.months.length).map((month, i) => ({ month, deaths: p.months[i] }));
  const spell = (key) => ({ key, ...conflict.conflicts[key] });
  const fought = p.conflicts.map(spell);
  return {
    deaths12: p.deaths12, months, byType: p.byType, trend: p.trend,
    last3: sum(p.months.slice(-3)), prev3: sum(p.months.slice(-6, -3)),
    fought,
    elsewhere: p.partyTo.filter(k => !p.conflicts.includes(k)).map(spell),
  };
}

/**
 * Tensions: pairs of countries whose military news (threats, force posture, fighting between them)
 * is above its normal (GDELT, published in current.activity.gdelt.tensions), the biggest surge
 * first: the most reports above the expected count. Never a level.
 * @returns [{ key, sides: [[placeId]], status, count, expected }]
 */
export function tensionRows(tensions, max = Infinity) {
  return Object.entries(tensions?.pairs ?? {}).map(([key, p]) => ({ key, ...p }))
    .sort((a, b) => (b.count - b.expected) - (a.count - a.expected) || a.key.localeCompare(b.key)).slice(0, max);
}

/** Sparkline points ("x,y x,y …") in a w × h box, with `pad` around; the lowest value sits at the bottom. */
export function sparkPoints(values, w, h, pad = 2) {
  if (!values.length) return '';
  const lo = Math.min(...values), hi = Math.max(...values);
  const x = (i) => (values.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (values.length - 1));
  const y = (v) => (hi === lo ? h / 2 : h - pad - ((v - lo) * (h - 2 * pad)) / (hi - lo));
  return values.map((v, i) => `${round(x(i))},${round(y(v))}`).join(' ');
}

/** Bars for monthly values in a w × h box: [{ x, y, w, h }], each at least 1px tall when not zero. */
export function barRects(values, w, h, gap = 2) {
  const hi = Math.max(1, ...values);
  const bw = (w - gap * (values.length - 1)) / values.length;
  return values.map((v, i) => {
    const bh = v ? Math.max(1, (v / hi) * h) : 0;
    return { x: round(i * (bw + gap)), y: round(h - bh), w: round(bw), h: round(bh) };
  });
}

/** UCDP's page of a conflict ("1:13243" -> its id 13243). */
export function conflictUrl(base, key) {
  return `${base}${key.split(':')[1]}`;
}

// ---- wars: who fights whom (UCDP's sides, with Wikipedia's context from risk/wars.json:
//   { conflicts: { key: { title, url, extract, start, map, sides: { a: { with, backers }, b }, names } } })

/** A war's short title: Wikipedia's without the years in brackets ("Russo-Ukrainian war"), else UCDP's, else null. */
export function warTitle(c, w) {
  if (w?.title) return w.title.replace(/\s*\([^()]*\)\s*$/, '');
  return c?.name ? conflictTitle(c) : null;
}

/**
 * One side's actors to show, most deaths first: [{ text, short, place? }]. A government is its
 * place; a group keeps UCDP's short name, and its full name from Wikipedia's infobox when known
 * (`names`: { RSF: 'Rapid Support Forces' }); an actor UCDP hasn't identified is `unnamed`, left
 * out when the side names someone.
 */
export function sideActors(actors, { placeName, names = {}, unnamed }) {
  const out = [];
  for (const a of actors) {
    const item = a.place ? { text: placeName(a.place), short: placeName(a.place), place: a.place }
      : a.name ? { text: names[a.name] ?? a.name, short: a.name }
        : { text: unnamed, short: unnamed, unnamed: true };
    if (!out.some(x => x.short === item.short)) out.push(item);
  }
  return out.length > 1 ? out.filter(x => !x.unnamed) : out;
}

/** The first `max` names of a list and how many more: { names: [..], more }. */
export function firstNames(list, max) {
  return { names: list.slice(0, max), more: Math.max(0, list.length - max) };
}

/**
 * The Wars list: every listed conflict, most deaths first (as published), with its two sides.
 * @returns [{ key, war, deaths12, last, trend, title, a: [actor], b: [actor] }]
 */
export function warRows(conflict, wars, opts) {
  return Object.entries(conflict.conflicts).map(([key, c]) => {
    const w = wars?.conflicts?.[key];
    const names = w?.names ?? {};
    return {
      key, war: c.war, deaths12: c.deaths12, last: c.last, trend: c.trend ?? null, title: warTitle(c, w),
      a: sideActors(c.sides.a, { ...opts, names }), b: sideActors(c.sides.b, { ...opts, names }),
    };
  });
}

/** New conflicts (first seen in the 12 months), most deaths first. */
export function newRows(conflict) {
  return (conflict.new ?? []).filter(k => conflict.conflicts[k]).sort((a, b) => conflict.conflicts[b].deaths12 - conflict.conflicts[a].deaths12);
}

/** Conflicts gone quiet: [{ key, title, deaths, lastDeaths, parties }], as published. */
export function quietRows(conflict, wars) {
  return (conflict.quiet ?? []).map(q => ({ ...q, title: warTitle(q, wars?.conflicts?.[q.key]) }));
}

/**
 * A war's card: its title and context, its sides (UCDP's actors, then the countries Wikipedia
 * puts with them and their backers), its deaths by month and trend. A conflict gone quiet has no
 * sides or months, only its last deaths. null for an unknown key.
 */
export function warModel(conflict, wars, key, opts) {
  const c = conflict.conflicts[key];
  const q = c ? null : conflict.quiet?.find(x => x.key === key);
  if (!c && !q) return null;
  const w = wars?.conflicts?.[key] ?? null;
  const side = (s) => ({ actors: sideActors(c.sides[s], { ...opts, names: w?.names ?? {} }), with: w?.sides?.[s]?.with ?? [], backers: w?.sides?.[s]?.backers ?? [] });
  return {
    key, title: warTitle(c ?? q, w), war: !!c?.war, quiet: q,
    start: w?.start ?? null, first: c?.first ?? null,
    deaths12: c?.deaths12 ?? 0, last: c?.last ?? 0, civilians12: c?.civilians12 ?? 0, trend: c?.trend ?? null,
    months: c ? windowMonths(conflict.through, c.months.length).map((month, i) => ({ month, deaths: c.months[i] })) : [],
    sides: c ? { a: side('a'), b: side('b') } : null,
    extract: w?.extract ?? null, url: w?.url ?? null, map: w?.map ?? null,
    places: c?.places ?? [], parties: c?.parties ?? q.parties,
  };
}

/**
 * What the map shows of a war: side A's and side B's places (UCDP's governments), the countries
 * Wikipedia puts with each side, and the places where it is fought. A side's place wins over an
 * ally's; a place on both sides is side A's.
 */
export function warFocus(m) {
  const a = new Set(m.sides?.a.actors.filter(x => x.place).map(x => x.place) ?? []);
  const b = new Set(m.sides?.b.actors.filter(x => x.place && !a.has(x.place)).map(x => x.place) ?? []);
  const taken = (p) => a.has(p) || b.has(p);
  const allyA = new Set((m.sides?.a.with ?? []).filter(p => !taken(p)));
  const allyB = new Set((m.sides?.b.with ?? []).filter(p => !taken(p) && !allyA.has(p)));
  // Gone quiet: no sides, only the parties, shown where it was fought.
  const fought = new Set([...m.places, ...(m.sides ? [] : m.parties)].filter(p => !taken(p)));
  return { key: m.key, a, b, allyA, allyB, fought };
}

/** A dot's radius for an event's deaths: 2px for one, growing with the square root, 9px at most. */
export function dotRadius(deaths) {
  return Math.min(9, round(1.6 + Math.sqrt(deaths) * 0.45));
}

const round = (n) => Math.round(n * 10) / 10;
