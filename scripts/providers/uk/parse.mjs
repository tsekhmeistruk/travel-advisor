// Parsing for UK Foreign, Commonwealth & Development Office (FCDO) travel advice (pure; the
// network side lives in ./index.mjs).
//
// Source: the GOV.UK Content API (Open Government Licence v3.0). The index lists every
// destination with its page and last-published time; each destination's page has
// `details.alert_status`, the FCDO's warnings against travel. The FCDO has no four-level
// scale, so its warnings are mapped onto 1–4 here (its own wording is shown on the site):
//   none                                              1
//   avoid all but essential travel to parts           2 (regional)
//   avoid all travel to parts                         3 (regional)
//   avoid all but essential travel to the whole country 3
//   avoid all travel to the whole country             4
// The most severe warning sets the level.

export const LEVEL_BY_ALERT = {
  avoid_all_but_essential_travel_to_parts: 2,
  avoid_all_travel_to_parts: 3,
  avoid_all_but_essential_travel_to_whole_country: 3,
  avoid_all_travel_to_whole_country: 4,
};

/** The destinations of the index: { name, slug, stamp (ISO), url, apiUrl }. */
export function parseIndex(json) {
  const children = json?.links?.children;
  if (!Array.isArray(children)) throw new Error('GOV.UK index has no list of destinations');
  return children.map(c => {
    const name = c.details?.country?.name;
    if (!name || !c.api_url || !c.public_updated_at) throw new Error(`GOV.UK destination without name, page or date: ${JSON.stringify(c).slice(0, 120)}`);
    return { name, slug: c.details.country.slug, stamp: new Date(c.public_updated_at).toISOString(), url: c.web_url, apiUrl: c.api_url };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Level from a destination's warnings: { level, regional, alerts }.
 * Throws on a warning it doesn't know, so a new FCDO category is noticed instead of misread.
 */
export function levelFromAlerts(alerts) {
  if (!Array.isArray(alerts)) throw new Error('GOV.UK page has no alert_status');
  let level = 1;
  for (const a of alerts) {
    const l = LEVEL_BY_ALERT[a];
    if (!l) throw new Error(`Unknown FCDO warning "${a}"`);
    level = Math.max(level, l);
  }
  const regional = alerts.some(a => a.endsWith('_to_parts')) && !alerts.includes('avoid_all_travel_to_whole_country');
  return { level, regional, alerts: [...alerts].sort() };
}

/** One destination's page: its warnings. */
export function parsePage(json) {
  return levelFromAlerts(json?.details?.alert_status);
}
