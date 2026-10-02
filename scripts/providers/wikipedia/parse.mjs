// Parsing for Wikipedia articles about wars (pure; the network side lives in ./index.mjs).
//
// What the Wars mode's war card takes from an article, beside UCDP's own sides (who fought, with
// deaths):
//   sides     the names in each `combatant1..3` list of its "Infobox military conflict":
//             `fighters` (every level of the list) and `backers` (after "Supported by"). Items
//             marked as past ("Wagner Group (until early 2024)", "(2013 only)", a period such as
//             "2013–2023:") are left out. The build keeps only the names that are countries, so
//             the infobox's notes and sub-units never reach the site.
//   names     the infobox's links by their short text ("RSF" -> "Rapid Support Forces"): the
//             build spells out UCDP's acronyms with them
//   start     when it began, from the infobox's `date` ("2023-04", or a year)
//   extract   the article's opening, from the REST summary, as Wikipedia gives it
//   image     the lead image's file (often a map of who controls what)
//
// The infobox is in the article's lead section: inline ({{Infobox military conflict …}} or
// {{#invoke:Infobox military conflict|main …}}), or in a template of its own ({{Yemeni civil
// war infobox}}), which ./index.mjs then reads. Wikipedia's text is CC BY-SA 4.0: the site
// credits it and links the article.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// A remark saying an item is no longer in the war: "(until early 2024)", "(2013 only)", "(2012–2015)".
const PAST = /\b(until|withdrew|withdrawn|defunct|dissolved|disbanded)\b|\b(19|20)\d\d\s*only\b|\b(19|20)\d\d\s*[–-]\s*(19|20)\d\d\b/i;
// A remark that hedges: the item is left out.
const HEDGE = /\b(alleged(ly)?|reported(ly)?|claimed|denied|disputed|suspected|unconfirmed)\b/i;
// A period heading in a list: "2013–2023" (over) or "2023–" / "2023–present" (now).
const PERIOD = /^(?:(19|20)\d\d)\s*[–-]\s*((?:19|20)\d\d|present)?\s*:?$/i;
// A line that is a note, not a fighter.
const NOTE = /\b(attacked by|self[- ]defen[cs]e|declared support|training|mediat|observers?|ceasefire|see also|various)\b/i;
const MAX_ITEMS = 40;

/**
 * The war infobox in a page's wikitext: { body } (the template's inside) when it is there,
 * { template } (a page name) when the article uses an infobox template of its own, else null.
 */
export function findInfobox(wikitext) {
  const text = wikitext.replace(/<!--[\s\S]*?-->/g, '').replace(/<noinclude>[\s\S]*?<\/noinclude>/gi, '');
  const inline = /\{\{\s*(?:#invoke:\s*)?Infobox military conflict\b/i.exec(text);
  if (inline) return { body: balanced(text, inline.index) };
  const own = /\{\{\s*([^{}|\n]+?\sinfobox)\s*(?:\||\}\})/i.exec(text);
  return own ? { template: `Template:${own[1].trim()}` } : null;
}

/** The inside of the template that opens at `start` ("{{"), nested templates included. */
function balanced(text, start) {
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    const two = text.slice(i, i + 2);
    if (two === '{{') { depth++; i++; } else if (two === '}}') {
      depth--;
      i++;
      if (depth === 0) return text.slice(start + 2, i - 1);
    }
  }
  return text.slice(start + 2);
}

/** Split at the top-level "|" (inside templates and links they are kept). */
function split(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; } else if ((two === '}}' || two === ']]') && depth > 0) { depth--; cur += two; i++; } else if (text[i] === '|' && depth === 0) { out.push(cur); cur = ''; } else cur += text[i];
  }
  out.push(cur);
  return out;
}

/** A template's named parameters: { name (lower case): raw value }. */
export function params(body) {
  const out = {};
  for (const p of split(body).slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) out[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return out;
}

const LIST = new Set(['ubl', 'unbulleted list', 'hlist', 'flatlist', 'bulleted list', 'blist', 'collapsible list', 'plainlist', 'plain list', 'indented plainlist']);
const REMARK = new Set(['small', 'smaller', 'nobold', 'noitalic']);
const KEEP = new Set(['nowrap', 'resize', 'big', 'larger']);
const FLAG = new Set(['flag', 'flagu', 'flagcountry', 'flag country', 'flagc', 'flagg', 'flagdeco+name']);

/** One template (no templates left inside) as plain text; templates not listed here give nothing. */
function template(inner) {
  const [rawName, ...rest] = split(inner);
  // A country by its code ({{IRN}}, {{USA}}): the build finds the place by its alpha-3 code.
  if (/^[A-Z]{3}$/.test(rawName.trim())) return rawName.trim();
  const name = rawName.trim().toLowerCase().replace(/_/g, ' ');
  const named = Object.fromEntries(rest.map(a => a.match(/^\s*([a-z][a-z0-9_ -]*?)\s*=([\s\S]*)$/i)).filter(Boolean).map(m => [m[1].toLowerCase(), m[2].trim()]));
  const positional = rest.filter(a => !/^\s*[a-z][a-z0-9_ -]*\s*=/i.test(a)).map(a => a.trim());
  if (FLAG.has(name) || /^#invoke:\s*flag\b/.test(name)) return named.name || positional.find(Boolean) || '';
  if (/^start date/.test(name)) {
    const [y, m, d] = positional.map(Number);
    return [d || '', m ? MONTHS[m - 1] : '', y || ''].filter(Boolean).join(' ');
  }
  if (REMARK.has(name)) return ` (${positional.join(' ')})`;
  if (KEEP.has(name)) return positional.join(' ');
  if (name === 'lang' || name === 'transl') return positional.at(-1) ?? '';
  if (LIST.has(name)) {
    const items = positional.filter(Boolean).map(item => (/^\s*\*/.test(item) ? `\n${item.trim()}` : `\n* ${item}`));
    return (named.title ? `\n* ${named.title}` : '') + items.join('');
  }
  if (name === 'nbsp' || name === 'snd' || name === 'spaced ndash') return ' ';
  if (name === 'ndash' || name === 'mdash') return '–';
  return '';
}

/** Wikitext as plain text: no comments, references, templates (flags give their country), links or markup. */
export function plain(value) {
  let s = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref\b[^>]*\/>/gi, '')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
  let before;
  do { before = s; s = s.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => template(inner)); } while (s !== before);
  return s
    .replace(/\[\[(?:File|Image):[^[\]]*(?:\[\[[^\]]*\]\][^[\]]*)*\]\]/gi, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, (_, link) => link.replace(/#.*$/, ''))
    .replace(/\[https?:\/\/\S+\s([^\]]*)\]/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

/**
 * One side of the infobox: { fighters, backers }, the names in its list (every level), without
 * remarks in brackets, past items, period headings and notes. "Supported by:" starts the backers.
 */
export function side(value) {
  const parts = { fighters: [], backers: [] };
  let target = 'fighters';
  let pastPeriod = false;
  for (const raw of plain(value).split('\n')) {
    let text = raw.trim().replace(/^[*#:]+/, '').trim();
    if (!text || /^-{3,}$/.test(text)) continue;
    const period = text.match(PERIOD);
    if (period) { pastPeriod = !!period[2] && !/present/i.test(period[2]); target = 'fighters'; continue; }
    const support = text.match(/^(?:supported by|support(?:ed)?|backed by)\b\s*:?\s*(.*)$/i);
    if (support) {
      target = 'backers';
      text = support[1];
      if (!text) continue;
    }
    if (pastPeriod || /:$/.test(text) || NOTE.test(text)) continue;
    const remarks = [...text.matchAll(/\(([^()]*)\)/g)].map(m => m[1]);
    if (remarks.some(r => PAST.test(r) || HEDGE.test(r))) continue;
    let name = text;
    for (let before = ''; before !== name;) { before = name; name = name.replace(/\s*\([^()]*\)/g, ''); }
    name = name.replace(/\s+/g, ' ').replace(/^[\s:;,–-]+|[\s:;,–-]+$/g, '').trim();
    if (/[a-z]{2}/i.test(name) && name.length <= 60 && !/[=()]/.test(name)) parts[target].push(name);
  }
  return { fighters: [...new Set(parts.fighters)].slice(0, MAX_ITEMS), backers: [...new Set(parts.backers)].slice(0, MAX_ITEMS) };
}

/** The sides of a war: combatant1..3 that name someone. */
export function sides(p) {
  return ['combatant1', 'combatant2', 'combatant3'].map(k => p[k]).filter(Boolean).map(side).filter(s => s.fighters.length || s.backers.length);
}

/** The infobox's links by their short text: { "RSF": "Rapid Support Forces" } (disambiguation dropped). */
export function names(p) {
  const out = {};
  const text = ['combatant1', 'combatant2', 'combatant3'].map(k => p[k] ?? '').join('\n').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
  for (const [, target, shown] of text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g)) {
    const full = target.trim().replace(/\s*\([^()]*\)$/, '');
    const short = shown.trim();
    if (short.length <= 15 && full.toLowerCase() !== short.toLowerCase() && !/[[\]{}|]/.test(short)) out[short] ??= full;
  }
  return out;
}

/** When a war began, from the infobox's `date`: "2023-04", "2009" or null. */
export function startDate(value) {
  if (!value) return null;
  const text = plain(value).toLowerCase();
  const month = `(${MONTHS.join('|')})`;
  const dayFirst = new RegExp(`\\b\\d{1,2}\\s+${month}\\s+(\\d{4})`).exec(text);
  const monthFirst = new RegExp(`\\b${month}\\s+(?:\\d{1,2},?\\s+)?(\\d{4})`).exec(text);
  const year = /\b(1[89]\d\d|20\d\d)\b/.exec(text);
  const found = [dayFirst, monthFirst].filter(Boolean).sort((a, b) => a.index - b.index)[0];
  if (found && (!year || found.index <= year.index)) return `${found[2]}-${String(MONTHS.indexOf(found[1]) + 1).padStart(2, '0')}`;
  return year ? year[1] : null;
}

/**
 * The REST summary of an article: { title, url, extract, revised, image } where image is the
 * lead image's file name and whether it looks like a map (an SVG, or "map" in its name).
 */
export function summary(json) {
  if (!json?.title || typeof json.extract !== 'string') throw new Error('not a page summary');
  const source = json.originalimage?.source ?? json.thumbnail?.source;
  let file = null;
  if (source) {
    const path = new URL(source).pathname.split('/');
    // A thumbnail ends in "960px-<file>.png": the file is the segment before it.
    file = decodeURIComponent(path.includes('thumb') ? path.at(-2) : path.at(-1));
  }
  return {
    title: json.title,
    url: json.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(json.title.replaceAll(' ', '_'))}`,
    extract: json.extract.trim(),
    revised: json.timestamp ?? null,
    image: file ? { file, map: /\.svg$/i.test(file) || /map/i.test(file) } : null,
  };
}
