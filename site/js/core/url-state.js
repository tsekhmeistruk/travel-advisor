// The part of the app's state that lives in the URL, so a view can be linked and shared:
//   #mode=disaster&place=mx&view=country, #mode=highest&view=list
// Pure: main.js reads location.hash and writes it back with history.replaceState.

/** { mode, place, view } from a location hash; missing parts are null. */
export function parseHash(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  return { mode: params.get('mode') || null, place: params.get('place') || null, view: params.get('view') || null };
}

/** The hash for a state: "#mode=travel", "#mode=disaster&place=mx", "…&view=country" (which needs a place), "…&view=list". */
export function formatHash({ mode, place, view }) {
  const params = new URLSearchParams();
  if (mode) params.set('mode', mode);
  if (place) params.set('place', place);
  if (view && (place || view === 'list')) params.set('view', view);
  const s = params.toString();
  return s ? `#${s}` : '';
}
