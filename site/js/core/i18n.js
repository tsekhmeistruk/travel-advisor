// Translation and locale-aware formatting. Pure: no DOM access, so it runs in Node tests.
//
// Messages live in site/i18n/<locale>.json as nested objects. t('a.b.c', params) looks up a
// message, falling back to the fallback locale (English), then to the key itself.
//   - {name} placeholders are replaced from params
//   - a message may be plural-aware: { "one": "...", "other": "..." }, chosen by params.count
// Dates, ages and country names use the browser's Intl APIs, so every language gets them for free.

const DAY = 864e5;

export function createI18n({ locale, messages, fallback = null, today = new Date() }) {
  const plural = new Intl.PluralRules(locale);
  const dateFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  const relLong = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const relShort = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames([locale], { type: 'region' }); } catch { /* unsupported: use registry names */ }
  const todayStart = startOfDay(today);

  function lookup(dict, key) {
    return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dict);
  }

  function t(key, params = {}) {
    let msg = lookup(messages, key);
    if (msg === undefined && fallback) msg = lookup(fallback, key);
    if (msg === undefined) return key;
    if (typeof msg === 'object') msg = msg[plural.select(params.count ?? 0)] ?? msg.other ?? key;
    return String(msg).replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  }

  /** Whole days between an ISO date ('YYYY-MM-DD') and today; never negative. */
  function ageDays(iso) {
    return Math.max(0, Math.round((todayStart - parseDay(iso)) / DAY));
  }

  return {
    locale,
    dir: lookup(messages, 'meta.dir') ?? 'ltr',
    t,
    has: (key) => lookup(messages, key) !== undefined || (fallback != null && lookup(fallback, key) !== undefined),
    ageDays,
    formatDate: (iso) => dateFmt.format(parseDay(iso)),
    /** "today", "yesterday", "11 days ago", "4 months ago", "2.1 years ago" */
    relativeAge(days) {
      if (days < 45) return relLong.format(-days, 'day');
      const months = Math.round(days / 30.44);
      if (months < 18) return relLong.format(-months, 'month');
      return relLong.format(-Math.round(days / 365.25 * 10) / 10, 'year');
    },
    /** Compact form for lists: "today", "11d ago", "3mo ago" */
    shortAge(days) {
      if (days < 45) return relShort.format(-days, 'day');
      return relShort.format(-Math.round(days / 30.44), 'month');
    },
    /** An age in hours, for data that changes within a day: "25 minutes ago", "5 hours ago", then relativeAge. */
    relativeHours(hours) {
      if (hours < 1) return relLong.format(-Math.floor(hours * 60), 'minute');
      if (hours < 24) return relLong.format(-Math.floor(hours), 'hour');
      return this.relativeAge(Math.floor(hours / 24));
    },
    /** Compact relativeHours for lists: "25m ago", "5h ago", then shortAge. */
    shortHours(hours) {
      if (hours < 1) return relShort.format(-Math.floor(hours * 60), 'minute');
      if (hours < 24) return relShort.format(-Math.floor(hours), 'hour');
      return this.shortAge(Math.floor(hours / 24));
    },
    /**
     * A place's display name: a translation in the locale file (places.<id>), then the
     * registry's curated English name for English, then the browser's name for its ISO code.
     */
    placeName(place) {
      const override = lookup(messages, `places.${place.id}`);
      if (override) return override;
      if (locale.startsWith('en') || !place.iso2 || !regionNames) return place.name;
      return regionNames.of(place.iso2) ?? place.name;
    },
  };
}

/** Pick the best available locale for the user: saved choice, then browser languages, then default. */
export function chooseLocale(available, { saved, browser = [], fallback = 'en' }) {
  if (saved && available.includes(saved)) return saved;
  for (const lang of browser) {
    if (available.includes(lang)) return lang;
    const base = lang.split('-')[0];
    if (available.includes(base)) return base;
  }
  return available.includes(fallback) ? fallback : available[0];
}

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function parseDay(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
