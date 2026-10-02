// Parsing for UCDP Candidate Events files (pure; the network side lives in ./index.mjs).
//
// UCDP (Uppsala Conflict Data Program) publishes its candidate events once a month: one CSV
// per version, v26.0.8 being August 2026. Each row is one event of organized violence: when,
// where (country, region), the conflict and its two sides, the type of violence (1 state-based,
// 2 non-state, 3 one-sided) and the deaths (`best`, UCDP's best estimate). Candidate data is
// preliminary: UCDP revises it in its yearly release, and a later file may correct an event.
//
// Only the facts the build needs are kept, as the source gave them (places are mapped in the
// build, so a mapping fix needs no new download):
//   format     FORMAT: the build refuses a version stored in another format, and the fetcher
//              downloads it again
//   month      the month the version covers ("2026-08")
//   countries  { countryId: UCDP's name }
//   actors     { actorId: UCDP's name }   ("Government of Sudan", "RSF", "Civilians", "XXX475")
//   conflicts  { "type:conflictId": { name } }   (UCDP reuses an id across types)
//   events     [[id, date, countryId, region (adm_1), "type:conflictId", deaths,
//                sideA, sideB (actor ids: who fought, the dyad), civilian deaths,
//                latitude, longitude (2 decimals, or null), precision (where_prec: 1 the exact
//                place … 4 a province, 6 only the country, 7 at sea or in the air)]]
//
// A conflict has one or more dyads: Sudan's government fought the RSF, the SFA and the SPLM-North
// in one conflict, so its sides are read from every event, not from the conflict.

export const FORMAT = 2;

const COLUMNS = ['id', 'type_of_violence', 'conflict_new_id', 'conflict_name', 'side_a_new_id', 'side_a', 'side_b_new_id', 'side_b',
  'country', 'country_id', 'adm_1', 'date_start', 'best', 'deaths_civilians', 'latitude', 'longitude', 'where_prec'];
// The files vary: most have a header (quoted or not, one with an extra leading "#" column), and
// v24.0.1 has none. A file without a header is read in the standard order of these 49 columns.
const STANDARD = ('id relid year active_year code_status type_of_violence conflict_dset_id conflict_new_id conflict_name '
  + 'dyad_dset_id dyad_new_id dyad_name side_a_dset_id side_a_new_id side_a side_b_dset_id side_b_new_id side_b '
  + 'number_of_sources source_article source_office source_date source_headline source_original where_prec '
  + 'where_coordinates where_description adm_1 adm_2 latitude longitude geom_wkt priogrid_gid country country_id '
  + 'region event_clarity date_prec date_start date_end deaths_a deaths_b deaths_civilians deaths_unknown best high '
  + 'low gwnoa gwnob').split(' ');

/** Rows of a CSV with quoted fields ("" is a quote inside one); fields may span lines. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * One version's events. Throws when the file isn't in the expected format (a missing column,
 * or most rows malformed), so a changed format is noticed instead of read wrong.
 */
export function parseVersion(csv) {
  let [header, ...rows] = parseCsv(csv);
  if (header && !header.includes('id') && /^\d+$/.test(header[0]) && header.length === STANDARD.length) {
    rows = [header, ...rows];
    header = STANDARD;
  }
  const col = Object.fromEntries(COLUMNS.map(c => [c, header?.indexOf(c) ?? -1]));
  const missing = COLUMNS.filter(c => col[c] < 0);
  if (missing.length) throw new Error(`UCDP file not in the expected format (missing ${missing.join(', ')})`);
  const countries = {};
  const actors = {};
  const conflicts = {};
  const events = [];
  let malformed = 0;
  for (const r of rows) {
    if (r.length === 1 && r[0] === '') continue;   // a trailing newline
    const deaths = Number(r[col.best]);
    const date = r[col.date_start]?.slice(0, 10);
    const countryId = Number(r[col.country_id]);
    const type = r[col.type_of_violence];
    const sideA = Number(r[col.side_a_new_id]);
    const sideB = Number(r[col.side_b_new_id]);
    if (r.length !== header.length || !Number.isInteger(deaths) || !/^\d{4}-\d\d-\d\d$/.test(date ?? '') || !countryId || !['1', '2', '3'].includes(type)
      || !/^\d+$/.test(r[col.side_a_new_id]) || !/^\d+$/.test(r[col.side_b_new_id])) {
      malformed++;
      continue;
    }
    const key = `${type}:${r[col.conflict_new_id]}`;
    countries[countryId] = r[col.country];
    actors[sideA] = r[col.side_a];
    actors[sideB] = r[col.side_b];
    conflicts[key] ??= { name: r[col.conflict_name] };
    events.push([Number(r[col.id]), date, countryId, r[col.adm_1], key, deaths, sideA, sideB,
      Number(r[col.deaths_civilians]) || 0, coordinate(r[col.latitude]), coordinate(r[col.longitude]), Number(r[col.where_prec]) || null]);
  }
  if (!events.length || malformed > events.length) throw new Error(`UCDP file not in the expected format (${events.length} events, ${malformed} malformed rows)`);
  events.sort((a, b) => a[1].localeCompare(b[1]) || a[0] - b[0]);
  return { format: FORMAT, countries: sortKeys(countries), actors: sortKeys(actors), conflicts: sortKeys(conflicts), events, malformed };
}

/** A latitude or longitude to 2 decimals (about 1 km), or null when there is none. */
function coordinate(text) {
  if (text == null || text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// ---- versions: "26.0.8" is the 8th month of 2026

const parts = (v) => v.split('.').map(Number);

/** The version after `v`: the next month, and after .12 the next year's .1. */
export function nextVersion(v) {
  const [yy, , m] = parts(v);
  return m >= 12 ? `${yy + 1}.0.1` : `${yy}.0.${m + 1}`;
}

/** The month a version covers: "26.0.8" -> "2026-08". */
export function versionMonth(v) {
  const [yy, , m] = parts(v);
  return `${2000 + yy}-${String(m).padStart(2, '0')}`;
}

/** The file of a version: GEDEvent_v26_0_8.csv. */
export function versionFile(v) {
  return `GEDEvent_v${v.replaceAll('.', '_')}.csv`;
}

function sortKeys(o) {
  return Object.fromEntries(Object.keys(o).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(k => [k, o[k]]));
}
