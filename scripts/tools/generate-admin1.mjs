// One-off generator for site/data/geo/admin1-lines.json: the borders between the states and
// provinces of the countries in COUNTRIES (the U.S. and Canada), which the map draws as a grid
// over them. Lines only, no shapes: the countries' own outlines stay those of the base map.
//
// Source: Natural Earth, "Admin 1 – States, provinces, boundary lines", 1:50m (public domain,
// naturalearthdata.com). Run it again to add a country (Natural Earth's 1:50m file also has
// Australia, Brazil, China, India, Indonesia, Russia and South Africa) or to refresh the lines.
//
// Usage: node scripts/tools/generate-admin1.mjs [a downloaded copy of the GeoJSON]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces_lines.geojson';
// Natural Earth's country code (ADM0_A3) -> our place id.
export const COUNTRIES = { USA: 'us', CAN: 'ca' };

/**
 * The lines of the chosen countries from Natural Earth's GeoJSON, by place id: each line a list
 * of [lon, lat] rounded to 2 decimals (about 1 km), without points that repeat the one before.
 */
export function admin1Lines(geojson, countries = COUNTRIES) {
  const out = Object.fromEntries(Object.values(countries).map(id => [id, []]));
  const round = (n) => Math.round(n * 100) / 100;
  for (const f of geojson.features) {
    const id = countries[f.properties?.ADM0_A3];
    if (!id || !f.geometry) continue;
    const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : f.geometry.type === 'LineString' ? [f.geometry.coordinates] : [];
    for (const line of lines) {
      const points = [];
      for (const [lon, lat] of line) {
        const p = [round(lon), round(lat)];
        const last = points.at(-1);
        if (!last || last[0] !== p[0] || last[1] !== p[1]) points.push(p);
      }
      if (points.length > 1) out[id].push(points);
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const local = process.argv[2];
  const geojson = local ? JSON.parse(readFileSync(local, 'utf8')) : await (await fetch(SOURCE)).json();
  const countries = admin1Lines(geojson);
  const file = new URL('../../site/data/geo/admin1-lines.json', import.meta.url);
  const body = `{"source": ${JSON.stringify(SOURCE)}, "licence": "Natural Earth, public domain", "countries": {\n${
    Object.entries(countries).map(([id, lines]) => `${JSON.stringify(id)}: [\n${lines.map(l => JSON.stringify(l)).join(',\n')}\n]`).join(',\n')}\n}}\n`;
  writeFileSync(file, body);
  for (const [id, lines] of Object.entries(countries)) console.log(`${id}: ${lines.length} lines, ${lines.reduce((n, l) => n + l.length, 0)} points`);
  console.log(`${fileURLToPath(file)}: ${Math.round(body.length / 1024)} KB`);
}
