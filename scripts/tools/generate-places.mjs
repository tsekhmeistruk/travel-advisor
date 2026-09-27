// One-off generator for config/places.json: the place registry every dataset refers to.
// Run it again only when the base map (site/data/geo/countries-50m.json), the map splits
// (site/js/map/splits.js) or POINT_PLACES change. Review the diff: ids must stay stable,
// because datasets, provider configs and history refer to them.
//
// Each place: { id, name, iso2?, shape? | point? }
//   id    - stable identifier: lowercase ISO 3166-1 alpha-2 code when the place is a whole
//           ISO territory, otherwise a slug of the English name
//   name  - English display name (other languages come from the browser via iso2)
//   iso2  - ISO 3166-1 alpha-2 code, only when the place *is* that territory
//   iso3  - the matching alpha-3 code (some sources, e.g. the Netherlands, use these)
//   shape - name of the map shape that draws it; point - [lon, lat] for places too small
//           for the base map
//
// Usage: node scripts/tools/generate-places.mjs   (needs the dev dependency i18n-iso-countries)

import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import countries from 'i18n-iso-countries';
import { splitFeatures } from '../../site/js/map/splits.js';

const root = new URL('../../', import.meta.url);
// The vendored topojson-client is a browser (UMD) build; run it in a sandbox to use it here.
const sandbox = { self: {} };
vm.runInNewContext(readFileSync(new URL('site/vendor/topojson-client.min.js', root), 'utf8'), sandbox);
const topojson = sandbox.topojson;

// Places too small for the base map, drawn as dots.
const POINT_PLACES = [
  { iso2: 'TV', point: [179.2, -8.5] },
  { iso2: 'GI', point: [-5.35, 36.14] },
  { iso2: 'TK', point: [-171.85, -9.2] },
];

// ISO codes for split shapes that are whole ISO territories.
const SPLIT_ISO = { 'French Guiana': 'GF', 'Martinique': 'MQ', 'Guadeloupe': 'GP', 'Réunion': 'RE', 'Mayotte': 'YT' };

// Shapes without an ISO code in the map data.
const NO_ID_ISO = { 'Kosovo': 'XK' };
const NO_ID_NAMES = {
  'Somaliland': 'Somaliland',
  'N. Cyprus': 'Northern Cyprus',
  'Indian Ocean Ter.': 'Australian Indian Ocean Territories',
  'Siachen Glacier': 'Siachen Glacier',
  'Ashmore and Cartier Is.': 'Ashmore and Cartier Islands',
};

// English names that read better than the standard (CLDR) ones.
const NAME_OVERRIDES = {
  CD: 'Democratic Republic of the Congo',
  CG: 'Republic of the Congo',
  MO: 'Macau',
  HK: 'Hong Kong',
  MM: 'Myanmar',
  CV: 'Cabo Verde',
  VC: 'Saint Vincent and the Grenadines',
  TF: 'French Southern and Antarctic Lands',
  PS: 'Palestinian Territories',
};

const englishNames = new Intl.DisplayNames(['en'], { type: 'region' });
function englishName(iso2) {
  return (NAME_OVERRIDES[iso2] ?? englishNames.of(iso2)).replace(/ & /g, ' and ').replace(/^St\. /, 'Saint ');
}
// Kosovo's XK is user-assigned; sources use XKX for it.
const alpha3 = (iso2) => (iso2 === 'XK' ? 'XKX' : countries.alpha2ToAlpha3(iso2));
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const topo = JSON.parse(readFileSync(new URL('site/data/geo/countries-50m.json', root), 'utf8'));
const features = splitFeatures(topojson.feature(topo, topo.objects.countries).features);

const places = [];
const usedIso = new Set();
for (const f of features) {
  const shape = f.properties.name;
  let iso2 = SPLIT_ISO[shape] ?? NO_ID_ISO[shape] ?? (f.id ? countries.numericToAlpha2(f.id) : undefined);
  if (iso2 && usedIso.has(iso2)) iso2 = undefined;           // e.g. Ashmore and Cartier shares Australia's code
  if (shape in NO_ID_NAMES) iso2 = undefined;
  const name = iso2 ? englishName(iso2) : (NO_ID_NAMES[shape] ?? shape);
  if (iso2) usedIso.add(iso2);
  places.push({ id: iso2 ? iso2.toLowerCase() : slug(name), name, ...(iso2 && { iso2, iso3: alpha3(iso2) }), shape });
}
for (const { iso2, point } of POINT_PLACES) {
  places.push({ id: iso2.toLowerCase(), name: englishName(iso2), iso2, iso3: alpha3(iso2), point });
}

places.sort((a, b) => a.id.localeCompare(b.id));
const ids = new Set();
for (const p of places) {
  if (ids.has(p.id)) throw new Error(`Duplicate place id ${p.id}`);
  ids.add(p.id);
}

writeFileSync(new URL('config/places.json', root), JSON.stringify(places, null, 1) + '\n');
console.log(`Wrote ${places.length} places (${places.filter(p => p.iso2).length} with ISO codes).`);
