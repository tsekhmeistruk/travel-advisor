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

const round = (n) => Math.round(n * 10) / 10;
