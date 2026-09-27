// The part of the app's state that lives in the URL, so a view can be linked and shared:
//   #mode=disaster&place=mx
// Pure: main.js reads location.hash and writes it back with history.replaceState.

/** { mode, place } from a location hash; missing parts are null. */
export function parseHash(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  return { mode: params.get('mode') || null, place: params.get('place') || null };
}

/** The hash for a state: "#mode=travel", "#mode=disaster&place=mx". */
export function formatHash({ mode, place }) {
  const params = new URLSearchParams();
  if (mode) params.set('mode', mode);
  if (place) params.set('place', place);
  const s = params.toString();
  return s ? `#${s}` : '';
}
