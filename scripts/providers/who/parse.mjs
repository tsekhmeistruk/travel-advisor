// Parsing for WHO Disease Outbreak News (pure; the network side lives in ./index.mjs).
//
// The API (an OData feed) gives each notice's id, title and publication date. There is no
// country field: the countries are the end of the title, after its last " - " or ", "
// ("Nipah virus disease - India", "Ebola disease …, Democratic Republic of the Congo & Uganda").
// Notices about a region or the world ("Yellow fever - Global") name no country; they are kept,
// but on no place. Official names that differ from the registry are aliased in
// config/sources/who.json; a name like "Mauritania and Senegal" is split in the build when the
// whole doesn't match (so "Trinidad and Tobago" stays one).
//
// Only the title, date and link are kept (WHO's text is copyrighted; the site links to it).

export const SCHEME = 'who-don';
export const NOTICE_URL = 'https://www.who.int/emergencies/disease-outbreak-news/item/';

/** Notices of one response: the `value` list of the OData body. */
export function parseNotices(body) {
  let json;
  try { json = JSON.parse(body); } catch { throw new Error('WHO response is not JSON'); }
  if (!Array.isArray(json?.value)) throw new Error('WHO response has no list of notices');
  return json.value.map(parseNotice);
}

export function parseNotice(n) {
  const title = ((n?.UseOverrideTitle && n.OverrideTitle) || n?.Title || '').trim();
  if (!n?.DonId || !title || !n.PublicationDate) throw new Error(`WHO notice without id, title or date: ${JSON.stringify(n).slice(0, 120)}`);
  const published = new Date(n.PublicationDate);
  if (Number.isNaN(+published)) throw new Error(`WHO notice ${n.DonId}: "${n.PublicationDate}" is not a date`);
  const names = countriesFromTitle(title);
  return {
    id: `who:DON:${n.DonId}`,
    code: 'DON',
    name: title,
    country: names.length ? names.join(', ') : undefined,
    iso3: [],
    native: { scheme: SCHEME, value: 'notice' },
    startedAt: published.toISOString(),
    toDate: published.toISOString(),
    current: false,
    url: `${NOTICE_URL}${encodeURIComponent(n.DonId)}`,
  };
}

// Words that end a title but are not a country.
const NOT_A_COUNTRY = /\b(global|region|regions|multi-?(country|locations?)|hemisphere|countries|situation|update|worldwide)\b/i;

/**
 * The country names at the end of a title, split at "&" and ", " (" and " is split later, in
 * the build, only if the whole name isn't a place). [] for a region or the world.
 */
export function countriesFromTitle(title) {
  // A dash followed by a space ("disease - India", also "disease- Ethiopia"), never one inside
  // a name ("Timor-Leste"); or a comma.
  const m = title.match(/^.*(?:\s*[-–—]\s|,\s)(.+)$/);
  if (!m) return [];
  const tail = m[1].trim();
  if (NOT_A_COUNTRY.test(tail)) return [];
  return tail.split(/\s*&\s*|,\s*/).map(s => s.trim()).filter(Boolean);
}
