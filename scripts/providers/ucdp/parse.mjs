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
//   month      the month the version covers ("2026-08")
//   countries  { countryId: UCDP's name }
//   conflicts  { "type:conflictId": { name, sideA, sideB } }   (UCDP reuses an id across types)
//   events     [[id, date, countryId, region (adm_1), "type:conflictId", deaths]]

const COLUMNS = ['id', 'type_of_violence', 'conflict_new_id', 'conflict_name', 'side_a', 'side_b',
  'country', 'country_id', 'adm_1', 'date_start', 'best'];
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
  const conflicts = {};
  const events = [];
  let malformed = 0;
  for (const r of rows) {
    if (r.length === 1 && r[0] === '') continue;   // a trailing newline
    const deaths = Number(r[col.best]);
    const date = r[col.date_start]?.slice(0, 10);
    const countryId = Number(r[col.country_id]);
    const type = r[col.type_of_violence];
    if (r.length !== header.length || !Number.isInteger(deaths) || !/^\d{4}-\d\d-\d\d$/.test(date ?? '') || !countryId || !['1', '2', '3'].includes(type)) {
      malformed++;
      continue;
    }
    const key = `${type}:${r[col.conflict_new_id]}`;
    countries[countryId] = r[col.country];
    conflicts[key] ??= { name: r[col.conflict_name], sideA: r[col.side_a], sideB: r[col.side_b] };
    events.push([Number(r[col.id]), date, countryId, r[col.adm_1], key, deaths]);
  }
  if (!events.length || malformed > events.length) throw new Error(`UCDP file not in the expected format (${events.length} events, ${malformed} malformed rows)`);
  events.sort((a, b) => a[1].localeCompare(b[1]) || a[0] - b[0]);
  return { countries: sortKeys(countries), conflicts: sortKeys(conflicts), events, malformed };
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
