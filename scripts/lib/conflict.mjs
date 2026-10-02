// The conflict category of the risk layer (pure): UCDP's events of organized violence turned into
// a level per place, the number of wars, and the figures the Wars mode shows. No file access.
//
//   level      by a place's deaths in the last `windowMonths` (all organized violence: state-based,
//              non-state, one-sided), through `bands`: 1,000+ Critical, 100+ High, 25+ Elevated
//   war        a state-based conflict (a government is a side) with `war.minDeaths` or more deaths
//              in 12 months, wherever it is fought (UCDP's own threshold, there per calendar year)
//   armed conflict   the same with `armedConflict.minDeaths` (25) or more, wars included
//   trend      a place's last `trend.months` months against the ones before: `up` (escalating)
//              or `down` (calming), or none
//
// The data is UCDP's candidate data: preliminary, and a month or two behind. `through` is the
// month of the latest version. Events are mapped to places here, from the source's country names
// (`countries`, with `regions` first for a split place, e.g. Gaza), so a mapping fix needs no
// new download.

const TYPES = { 1: 'state', 2: 'nonState', 3: 'oneSided' };

/** The month `k` months after `month` ("2026-08", -2 -> "2026-06"). */
export function addMonths(month, k) {
  const [y, m] = month.split('-').map(Number);
  const i = y * 12 + (m - 1) + k;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** The `n` months ending with `month`, oldest first. */
export function monthsBack(month, n) {
  return Array.from({ length: n }, (_, i) => addMonths(month, i - n + 1));
}

/** Governments named on a side: "Government of Israel, Government of United States of America" -> ["Israel", "United States of America"]. */
export function governments(side) {
  return side.split(/,\s*(?=Government of )/).map(p => p.match(/^Government of (.+)$/)?.[1]).filter(Boolean);
}

/** The level for a number of deaths: the first band reached, else Normal. */
export function bandLevel(deaths, bands) {
  return bands.find(b => deaths >= b.minDeaths)?.level ?? 1;
}

/** 'up' or 'down' when the last months moved enough against the ones before, else null. */
export function trendOf(last, prev, rule) {
  if (last >= rule.minDeaths && last >= rule.upRatio * prev) return 'up';
  if (prev >= rule.minDeaths && last <= rule.downRatio * prev) return 'down';
  return null;
}

const add = (map, key, n) => map.set(key, (map.get(key) ?? 0) + n);
const sum = (map, months) => months.reduce((n, m) => n + (map?.get(m) ?? 0), 0);

/**
 * @param data    { fetchedAt, versions: [{ version, month, countries, conflicts, events }] }, oldest first
 * @param config  config/sources/<id>.json
 * @returns {
 *   through, signals: Map placeId -> { level, basis },
 *   published: the body of risk/conflict.json,
 *   byPlace: { placeId: the place's figures with its conflicts spelled out } (for place files),
 *   warnings
 * }
 */
export function conflictSignals(sourceId, data, config) {
  const latest = data.versions.at(-1);
  const through = latest.month;
  const first = data.versions[0].month;
  const window = monthsBack(through, config.windowMonths);
  const inWindow = new Set(window);

  // A later version wins for an event it repeats (UCDP corrects candidate events).
  const events = new Map();
  const countries = {};
  const meta = {};
  for (const v of data.versions) {
    Object.assign(countries, v.countries);
    Object.assign(meta, v.conflicts);
    for (const e of v.events) events.set(e[0], e);
  }
  const unknown = new Set();
  const placeOf = (name, region) => {
    const id = config.regions?.[name]?.[region] ?? config.countries[name];
    if (!id) unknown.add(name);
    return id;
  };

  const world = new Map();          // month -> deaths
  const placeMonths = new Map();    // place -> month -> deaths
  const placeTypes = new Map();     // place -> { state, nonState, oneSided } in the window
  const conflictMonths = new Map(); // state-based conflict -> month -> deaths
  const conflictPlaces = new Map(); // state-based conflict -> place -> deaths in the window
  for (const [, date, countryId, region, key, deaths] of events.values()) {
    const month = date.slice(0, 7);
    if (month > through) continue;
    add(world, month, deaths);
    const state = key.startsWith('1:');
    if (state) add(conflictMonths.get(key) ?? conflictMonths.set(key, new Map()).get(key), month, deaths);
    const place = placeOf(countries[countryId] ?? `#${countryId}`, region);
    if (!place) continue;
    add(placeMonths.get(place) ?? placeMonths.set(place, new Map()).get(place), month, deaths);
    if (!inWindow.has(month)) continue;
    const types = placeTypes.get(place) ?? placeTypes.set(place, { state: 0, nonState: 0, oneSided: 0 }).get(place);
    types[TYPES[key[0]]] += deaths;
    if (state) add(conflictPlaces.get(key) ?? conflictPlaces.set(key, new Map()).get(key), place, deaths);
  }

  // The war count per month, where a whole window of data is behind it.
  const seriesMonths = monthsBack(through, config.seriesMonths).filter(m => m >= first);
  const countAt = (month, min) => {
    const months = monthsBack(month, config.windowMonths);
    if (months[0] < first) return null;
    return [...conflictMonths.values()].filter(byMonth => sum(byMonth, months) >= min).length;
  };

  // State-based conflicts with at least an armed conflict's deaths in the window.
  const conflicts = {};
  const partyTo = new Map();   // place -> conflict keys
  const ranked = [...conflictMonths].map(([key, byMonth]) => [key, sum(byMonth, window)])
    .filter(([, deaths]) => deaths >= config.armedConflict.minDeaths)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en', { numeric: true }));
  for (const [key, deaths12] of ranked) {
    const m = meta[key];
    // A side still unnamed ("XXX475") is that country's government (475: Nigeria) in a state-based conflict.
    const named = [m.sideA, m.sideB].flatMap(s => (/^XXX\d+$/.test(s) ? [countries[s.slice(3)]].filter(Boolean) : governments(s)));
    const parties = [...new Set(named.map(n => placeOf(n)).filter(Boolean))].sort();
    for (const p of parties) (partyTo.get(p) ?? partyTo.set(p, []).get(p)).push(key);
    conflicts[key] = {
      name: /^XXX/.test(m.name) ? null : m.name,   // UCDP hasn't named it yet: the sides say who
      sideA: m.sideA, sideB: m.sideB, deaths12, last: conflictMonths.get(key).get(through) ?? 0,
      war: deaths12 >= config.war.minDeaths,
      places: [...(conflictPlaces.get(key) ?? [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p),
      parties,
    };
  }

  const places = {};
  const signals = new Map();
  const n = config.trend.months;
  for (const id of [...new Set([...placeTypes.keys(), ...partyTo.keys()])].sort()) {
    const byMonth = placeMonths.get(id);
    const deaths12 = sum(byMonth, window);
    const fought = Object.keys(conflicts).filter(k => conflicts[k].places.includes(id))
      .sort((a, b) => (conflictPlaces.get(b).get(id) - conflictPlaces.get(a).get(id)) || a.localeCompare(b, 'en', { numeric: true }));
    places[id] = {
      deaths12,
      months: window.map(m => byMonth?.get(m) ?? 0),
      byType: placeTypes.get(id) ?? { state: 0, nonState: 0, oneSided: 0 },
      trend: trendOf(sum(byMonth, monthsBack(through, n)), sum(byMonth, monthsBack(addMonths(through, -n), n)), config.trend),
      conflicts: fought,
      partyTo: partyTo.get(id) ?? [],
    };
    const level = bandLevel(deaths12, config.bands);
    if (level > 1) signals.set(id, { level, basis: [`${sourceId}:${through}`] });
  }

  const spell = (keys) => keys.map(key => ({ key, ...conflicts[key] }));
  const byPlace = Object.fromEntries(Object.entries(places).map(([id, p]) => [id, { through, ...p, conflicts: spell(p.conflicts), partyTo: spell(p.partyTo) }]));
  const published = {
    asOf: data.fetchedAt, source: sourceId, version: latest.version, through, preliminary: true,
    links: { home: config.links?.home, conflict: config.links?.conflict },
    windowMonths: config.windowMonths, bands: config.bands.map(b => b.minDeaths), warDeaths: config.war.minDeaths,
    series: {
      months: seriesMonths,
      deaths: seriesMonths.map(m => world.get(m) ?? 0),
      wars: seriesMonths.map(m => countAt(m, config.war.minDeaths)),
      armedConflicts: seriesMonths.map(m => countAt(m, config.armedConflict.minDeaths)),
    },
    conflicts,
    places,
  };
  const warnings = unknown.size ? [`[${sourceId}] countries not in config/sources/${sourceId}.json: ${[...unknown].sort().join(', ')}`] : [];
  return { through, signals, published, byPlace, warnings };
}
