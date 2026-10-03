// The map's mascot: an explorer standing in Canada, north of Toronto (a capybara, or the goose:
// characters.js has the drawings, and the visitor picks one). Decoration only: a pin on the map
// (world-map.js), so it stays at a fixed size and leaves the screen with Canada when the map is
// zoomed elsewhere. A click on it never reaches the map: it does a small act instead
// (antics.js). Where it looks is gaze.js; this file puts it on the map and moves its head.
//
// The head turns by layers that move by different amounts (ears least, the muzzle most), from
// --gx and --gy (the gaze, -1..1) on the element; the CSS (.mascot in styles.css) animates it,
// and the act that is playing (data-antic). The walk goes by --wx and --wy: how far the U.S. is.

import { createGaze, gazeToward } from './gaze.js';
import { createAntics } from './antics.js';
import { character, DEFAULT_CHARACTER } from './characters.js';

export const HOME = [-79.4, 45.4];     // lon, lat: north of Toronto, inside Canada at any size
export const WALK_TO = [-80.5, 38.5];  // where it walks to and back: West Virginia, in the U.S.
const SIZE = 0.62;                      // the drawings are about 100 units tall: 62px at full size
const WALK_MAX = 240;                   // px on screen: zoomed in, it doesn't walk off the view

/**
 * Put the mascot on the map. lookAt({ placeIds, markerId }) turns it towards a selection
 * (nothing: back to the east). A click on it plays an act, to the end (antics.js).
 * setCharacter(id) changes who stands there.
 */
export function createMascot(map, { home = HOME, walkTo = WALK_TO, character: first = DEFAULT_CHARACTER, doc = document } = {}) {
  const pin = map.pin(home[0], home[1]);
  // The drawing sits in a group of its own, which the walk moves (the element keeps its scale).
  pin.innerHTML = `<g class="mascot" aria-hidden="true" transform="scale(${SIZE})"><g class="mascot-walk"></g></g>`;
  const el = pin.firstElementChild;
  let who = null;

  // A blink now and then, and when it turns to the visitor.
  let blinkTimer = null;
  const blink = () => {
    el.classList.add('is-blink');
    setTimeout(() => el.classList.remove('is-blink'), 140);
  };
  const blinkLater = () => { blinkTimer = setTimeout(() => { blink(); blinkLater(); }, 3000 + Math.random() * 3500); };
  blinkLater();

  const gaze = createGaze({
    apply: (g) => {
      el.dataset.look = g.look;
      el.style.setProperty('--gx', g.x);
      el.style.setProperty('--gy', g.y);
      if (g.look === 'user') blink();
    },
  });

  /** How far the walk goes, in the drawing's units: to the U.S. as the map shows it now. */
  function walkBy() {
    const from = map.projection(home), to = map.projection(walkTo);
    let dx = (to[0] - from[0]) * map.transform.k, dy = (to[1] - from[1]) * map.transform.k;
    const far = Math.hypot(dx, dy);
    if (far > WALK_MAX) { dx *= WALK_MAX / far; dy *= WALK_MAX / far; }
    const unit = SIZE * map.pinScale;
    return [dx / unit, dy / unit];
  }
  // A click is the mascot's own: the map below (Canada) is not selected.
  const antics = createAntics({
    apply: (name, ms) => {
      if (!name) { delete el.dataset.antic; return; }
      el.style.setProperty('--ms', ms);
      if (name === 'walk') {
        const [x, y] = walkBy();
        el.style.setProperty('--wx', x.toFixed(1));
        el.style.setProperty('--wy', y.toFixed(1));
      }
      el.dataset.antic = name;
    },
  });
  el.addEventListener('click', (event) => { event.stopPropagation(); antics.play(); });

  const activity = () => gaze.activity();
  for (const type of ['pointerdown', 'keydown']) doc.addEventListener(type, activity, { capture: true, passive: true });

  let lastTarget = {};
  const api = {
    lookAt(target = {}) {
      lastTarget = target;
      const to = map.focusPoint(target);
      // From its eyes: a fixed height on screen, so less of the map the closer the zoom.
      const [x, y] = map.projection(home);
      gaze.setTarget(to ? gazeToward([x, y - (who.eyes * SIZE * map.pinScale) / map.transform.k], to) : null);
    },
    /** Who stands there: an id of characters.js (unknown: the first). An act that is playing ends. */
    setCharacter(id) {
      const next = character(id);
      if (next === who) return;
      who = next;
      antics.stop();
      delete el.dataset.antic;
      el.dataset.character = who.id;
      el.firstElementChild.innerHTML = who.drawing;
      api.lookAt(lastTarget);
    },
    get character() { return who.id; },
    stop() {
      gaze.stop();
      antics.stop();
      clearTimeout(blinkTimer);
      for (const type of ['pointerdown', 'keydown']) doc.removeEventListener(type, activity, { capture: true });
    },
  };
  api.setCharacter(first);
  return api;
}
