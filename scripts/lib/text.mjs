// Text helpers shared by the fetch scripts.

const NAMED_ENTITIES = {
  amp: '&', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', egrave: 'è', ccedil: 'ç',
};

// Decode the HTML entities these sources use (numeric, hex, and a few named ones).
export function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}

// Spelling-insensitive key for a place name: "Côte d’Ivoire" and "Cote d Ivoire" match.
export function nameKey(name) {
  return name.normalize('NFD').replace(/[^a-z]/gi, '').toLowerCase();
}

// Strip tags and collapse whitespace.
export function plainText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
