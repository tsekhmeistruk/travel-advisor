// Pure build logic: matches advisories to map shapes, classifies updates and tracks level
// history. File I/O lives in scripts/build-data.mjs; tests import this module directly.

// Advisory name -> map shape name(s), where they differ. Keys are unique across
// both sources, so one table serves both. Shapes named Gaza, West Bank, French Guiana,
// Martinique, Guadeloupe, Réunion, Mayotte, Bonaire, Saba and Sint Eustatius, Azores and
// Canary Islands don't exist in the raw map; js/app.js splits them out at load time.
export const SHAPE_ALIASES = {
  // Shared spellings
  'Antigua and Barbuda': 'Antigua and Barb.',
  'Bosnia and Herzegovina': 'Bosnia and Herz.',
  'British Virgin Islands': 'British Virgin Is.',
  'Burma': 'Myanmar',
  'Cayman Islands': 'Cayman Is.',
  'Central African Republic': 'Central African Rep.',
  'Dominican Republic': 'Dominican Rep.',
  'Equatorial Guinea': 'Eq. Guinea',
  'Eswatini': 'eSwatini',
  'French Polynesia': 'Fr. Polynesia',
  'Marshall Islands': 'Marshall Is.',
  'North Macedonia': 'Macedonia',
  'Saint Kitts and Nevis': 'St. Kitts and Nevis',
  'Solomon Islands': 'Solomon Is.',
  'South Sudan': 'S. Sudan',
  'Turks and Caicos Islands': 'Turks and Caicos Is.',
  // U.S. spellings
  'Côte d’Ivoire': "Côte d'Ivoire",
  'Democratic Republic of the Congo': 'Dem. Rep. Congo',
  'Federated States of Micronesia': 'Micronesia',
  'French Saint Martin': 'St-Martin',
  'Kingdom of Denmark': 'Denmark',
  'Macau': 'Macao',
  'Republic of the Congo': 'Congo',
  'Saint Barthelemy': 'St-Barthélemy',
  'Saint Vincent and the Grenadines': 'St. Vin. and Gren.',
  'São Tomé and Príncipe': 'São Tomé and Principe',
  'The Bahamas': 'Bahamas',
  'The Gambia': 'Gambia',
  'The Kyrgyz Republic': 'Kyrgyzstan',
  // Canadian spellings
  "Côte d'Ivoire (Ivory Coast)": "Côte d'Ivoire",
  'Democratic Republic of Congo (Kinshasa)': 'Dem. Rep. Congo',
  'Republic of Congo (Brazzaville)': 'Congo',
  'Falkland Islands': 'Falkland Is.',
  'Cook Islands': 'Cook Is.',
  'Gambia, The': 'Gambia',
  'Israel and Palestine': ['Israel', 'Gaza', 'West Bank'],
  'Micronesia (FSM)': 'Micronesia',
  'Northern Marianas': 'N. Mariana Is.',
  'Saint Martin': 'St-Martin',
  'Saint Vincent & the Grenadines': 'St. Vin. and Gren.',
  'Saint-Barthélemy': 'St-Barthélemy',
  'Saint-Pierre-et-Miquelon': 'St. Pierre and Miquelon',
  'Sao Tome and Principe': 'São Tomé and Principe',
  'Timor-Leste (East Timor)': 'Timor-Leste',
  'Türkiye': 'Turkey',
  'United States': 'United States of America',
  'Virgin Islands (U.S.)': 'U.S. Virgin Is.',
};

// Places too small to exist in the map data; drawn as a dot at [lon, lat].
export const POINT_ONLY = {
  'Tuvalu': [179.2, -8.5],
  'Gibraltar': [-5.35, 36.14],
  'Tokelau': [-171.85, -9.2],
};

// Advisories that cover several places which already have their own advisories.
export const NO_SHAPE_NOTES = {
  'French West Indies': 'See also Guadeloupe, Martinique, Saint Barthélemy, Saint Martin.',
};

export const SPLIT_SHAPES = ['Gaza', 'West Bank', 'French Guiana', 'Martinique', 'Guadeloupe', 'Réunion', 'Mayotte',
  'Bonaire', 'Saba and Sint Eustatius', 'Azores', 'Canary Islands'];

export const SOURCES = {
  us: {
    label: 'United States',
    agency: 'U.S. State Department',
    link: 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html',
    home: 'United States of America',
    // Map shapes with no advisory of their own that fall under another advisory.
    coveredBy: {
      'Somaliland': 'Somalia', 'N. Cyprus': 'Cyprus', 'Faeroe Is.': 'Kingdom of Denmark', 'Åland': 'Finland',
      'Azores': 'Portugal', 'Canary Islands': 'Spain', 'Réunion': 'France', 'Mayotte': 'France',
    },
    territories: ['Puerto Rico', 'Guam', 'U.S. Virgin Is.', 'American Samoa', 'N. Mariana Is.'],
    levels: {
      1: { name: 'Exercise normal precautions', short: 'Normal', desc: 'The lowest advisory level. Some safety and security risk exists in any international travel.' },
      2: { name: 'Exercise increased caution', short: 'Caution', desc: 'Be aware of heightened risks to safety and security.' },
      3: { name: 'Reconsider travel', short: 'Reconsider', desc: 'Avoid travel due to serious risks to safety and security.' },
      4: { name: 'Do not travel', short: 'Do not travel', desc: 'Greater likelihood of life-threatening risks. The U.S. government may have very limited ability to help.' },
    },
  },
  ca: {
    label: 'Canada',
    agency: 'Government of Canada',
    link: 'https://travel.gc.ca/travelling/advisories',
    home: 'Canada',
    coveredBy: { 'Somaliland': 'Somalia', 'N. Cyprus': 'Cyprus', 'Faeroe Is.': 'Denmark', 'Åland': 'Finland' },
    territories: [],
    levels: {
      1: { name: 'Take normal security precautions', short: 'Normal', desc: 'Take similar precautions to those you would take in Canada.' },
      2: { name: 'Exercise a high degree of caution', short: 'High caution', desc: 'There are identifiable safety and security concerns, or the situation could change quickly. Be very cautious at all times.' },
      3: { name: 'Avoid non-essential travel', short: 'Non-essential', desc: 'Specific safety and security concerns could put you at risk. Think about whether you really need to travel.' },
      4: { name: 'Avoid all travel', short: 'Avoid all', desc: 'You should not travel here. Your personal safety and security are at great risk.' },
    },
  },
};

// Attach map placement: shape(s), a point, or a note. Drops fetch-only bookkeeping fields.
export function place({ stamp, lastSeen, ...a }) {
  if (POINT_ONLY[a.name]) return { ...a, point: POINT_ONLY[a.name] };
  if (NO_SHAPE_NOTES[a.name]) return { ...a, note: NO_SHAPE_NOTES[a.name] };
  const shapes = SHAPE_ALIASES[a.name] ?? a.name;
  return { ...a, shapes: Array.isArray(shapes) ? shapes : [shapes] };
}

// Change notes that mean "nothing about the risk changed". Each ';'-separated part
// of a note must match for the update to count as minor.
export const MINOR_CHANGE = [
  /editorial change/i,                                                  // Canada
  /health section was updated - travel health information/i,           // Canada: generic health-info refresh
  /(reissued|updated) after periodic review,? (without changes|with minor edits)\.?$/i, // U.S.
  /reissued with obsolete .*links? removed/i,                           // U.S.
];
export function isMinorChange(text) {
  const parts = text.split(/;\s*/).filter(Boolean);
  return parts.length > 0 && parts.every(p => MINOR_CHANGE.some(re => re.test(p)));
}

// Decide which "last updated" dates count as real updates. With a change note, minor edits
// are flagged. Without one, fall back to spotting bulk republishes: a site that re-stamps
// every page at once leaves one date on most entries, so a date shared by over 40% of a
// source is treated as a republish, not a content change.
export function classifyUpdates(advisories) {
  const counts = {};
  for (const a of advisories) counts[a.updated] = (counts[a.updated] || 0) + 1;
  for (const a of advisories) {
    if (a.change) { if (isMinorChange(a.change)) a.minorUpdate = true; }
    else if (counts[a.updated] > advisories.length * 0.4) a.minorUpdate = true;
  }
}

// Record each advisory's level per snapshot date; report the latest level change.
export function trackHistory(history, sourceKey, asOf, advisories) {
  const book = (history[sourceKey] ??= {});
  for (const a of advisories) {
    const log = (book[a.name] ??= []);
    const last = log[log.length - 1];
    if (!last || (last.level !== a.level && asOf > last.date)) log.push({ date: asOf, level: a.level });
    if (log.length >= 2) {
      const [prev, cur] = log.slice(-2);
      a.levelChange = { date: cur.date, from: prev.level, to: cur.level };
    }
  }
}

// Map shape names: every country in the base map plus the shapes js/app.js splits out.
export function mapNamesFrom(topo) {
  const names = new Set(topo.objects.countries.geometries.map(g => g.properties.name));
  for (const s of SPLIT_SHAPES) names.add(s);
  return names;
}

/**
 * Build every source's site data.
 * @param raw      { [key]: { asOf: 'YYYY-MM-DD', advisories: [...] } } from data/sources/*.json
 * @param history  level history (data/history.json); updated in place
 * @param mapNames Set of placeable shape names (mapNamesFrom(topo))
 * @returns { sources, problems } where problems lists advisories that can't be placed
 */
export function buildSources(raw, history, mapNames) {
  const problems = [];
  const sources = {};
  for (const [key, { asOf, advisories }] of Object.entries(raw)) {
    const meta = SOURCES[key];
    if (!meta) { problems.push(`Unknown source "${key}"`); continue; }
    const placed = advisories.map(place);
    classifyUpdates(placed);
    trackHistory(history, key, asOf, placed);

    const names = new Set(placed.map(a => a.name));
    for (const a of placed) for (const s of a.shapes || []) {
      if (!mapNames.has(s)) problems.push(`[${key}] No map shape "${s}" for advisory "${a.name}"`);
    }
    for (const [shape, adv] of Object.entries(meta.coveredBy)) {
      if (!mapNames.has(shape)) problems.push(`[${key}] coveredBy shape "${shape}" not in map`);
      if (!names.has(adv)) problems.push(`[${key}] coveredBy advisory "${adv}" not in data`);
    }
    sources[key] = { ...meta, asOf, advisories: placed };
  }
  return { sources, problems };
}

// Output files are plain JS (not JSON) so index.html also works when opened from disk.
export function renderAdvisoriesJs(sources) {
  return `// Generated by scripts/build-data.mjs. Do not edit by hand.
window.ADVISORY_DATA = ${JSON.stringify({ sources }, null, 1)};
`;
}
export function renderWorldJs(topo) {
  return `// Generated by scripts/build-data.mjs from world-atlas countries-50m (Natural Earth, public domain).
window.WORLD_TOPO = ${JSON.stringify(topo)};
`;
}
