// The part of the app's state that lives in the URL, so a view can be linked and shared:
//   #mode=disaster&place=mx&view=country, #mode=highest&view=list, #mode=wars&war=1-309
// A war is a UCDP conflict key ("1:309"), written with a dash so the link stays readable.
// Pure: main.js reads location.hash and writes it back with history.replaceState.

/** { mode, place, view, war } from a location hash; missing parts are null. */
export function parseHash(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const war = params.get('war');
  return { mode: params.get('mode') || null, place: params.get('place') || null, view: params.get('view') || null, war: /^\d+[-:]\d+$/.test(war ?? '') ? war.replace('-', ':') : null };
}

/**
 * What the page starts with. A link (a fresh navigation) opens its place, war or list; a refresh
 * starts at home: the mode only, nothing selected and no list.
 * @param parsed      parseHash(location.hash)
 * @param navigation  the navigation type: 'navigate', 'reload', 'back_forward', …
 */
export function startState(parsed, navigation) {
  return navigation === 'reload' ? { mode: parsed.mode, place: null, view: null, war: null } : parsed;
}

/** The hash for a state: "#mode=travel", "#mode=disaster&place=mx", "…&view=country" (which needs a place), "…&view=list", "#mode=wars&war=1-309". */
export function formatHash({ mode, place, view, war }) {
  const params = new URLSearchParams();
  if (mode) params.set('mode', mode);
  if (place) params.set('place', place);
  else if (war) params.set('war', war.replace(':', '-'));
  if (view && (place || view === 'list')) params.set('view', view);
  const s = params.toString();
  return s ? `#${s}` : '';
}
