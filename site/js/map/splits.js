// Polygons the base map merges into one country but that are separate places here
// (they have their own advisories, and may have their own data in other datasets).
// Each rule claims the polygons whose bounding-box centre [lon, lat] passes the test;
// whatever is left keeps the original shape name.
//
// Used by the map at runtime and by scripts/tools/generate-places.mjs, so the place
// registry and the map always agree on which split shapes exist.

export const SPLITS = {
  'Palestine': [
    { name: 'Gaza', test: ([x]) => x < 34.6 },
    { name: 'West Bank', test: () => true },
  ],
  'France': [
    { name: 'French Guiana', test: ([x, y]) => x < -50 && y > 0 && y < 7 },
    { name: 'Martinique', test: ([x, y]) => x > -61.4 && x < -60.6 && y > 14 && y < 15 },
    { name: 'Guadeloupe', test: ([x, y]) => x > -62 && x < -61 && y > 15.7 && y < 16.7 },
    { name: 'Réunion', test: ([x, y]) => x > 55 && y < -20 },
    { name: 'Mayotte', test: ([x, y]) => x > 44 && x < 46 && y < -12 },
  ],
  'Netherlands': [
    { name: 'Bonaire', test: ([x, y]) => x < -68 && y < 13 },
    { name: 'Saba and Sint Eustatius', test: ([x, y]) => x > -63.5 && x < -62.5 && y > 17 },
  ],
  'Portugal': [
    { name: 'Azores', test: ([x, y]) => x < -24 && y > 36 },
  ],
  'Spain': [
    { name: 'Canary Islands', test: ([, y]) => y < 30 },
  ],
};

export const SPLIT_SHAPE_NAMES = Object.values(SPLITS).flat().map(r => r.name);

/** Split merged features per SPLITS. Input and output are GeoJSON features. */
export function splitFeatures(features) {
  const out = [];
  for (const f of features) {
    const rules = SPLITS[f.properties.name];
    if (!rules) { out.push(f); continue; }
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const groups = new Map();
    const rest = [];
    for (const poly of polys) {
      const rule = rules.find(rl => rl.test(bboxCenter(poly[0])));
      if (!rule) { rest.push(poly); continue; }
      if (!groups.has(rule.name)) groups.set(rule.name, []);
      groups.get(rule.name).push(poly);
    }
    if (rest.length) out.push(makeFeature(f.properties.name, rest, f.id));
    for (const [name, g] of groups) out.push(makeFeature(name, g));
  }
  return out;
}

function makeFeature(name, polys, id) {
  return { type: 'Feature', id, properties: { name }, geometry: { type: 'MultiPolygon', coordinates: polys } };
}

function bboxCenter(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}
