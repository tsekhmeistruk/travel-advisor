// Small DOM helpers.

export const $ = (id) => document.getElementById(id);

/** Escape text for safe use in HTML strings (all data from sources passes through here). */
export function esc(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Only allow http(s) links from data into href attributes. */
export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}
