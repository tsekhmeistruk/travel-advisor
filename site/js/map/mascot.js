// The map's mascot: an explorer standing in Canada, north of Toronto (a capybara, or the goose:
// characters.js has the drawings, and the visitor picks one). Decoration only: a pin on the map
// (world-map.js), so it stays at a fixed size and leaves the screen with its place when the map
// is zoomed elsewhere. A click on it never reaches the map: it does a small act instead
// (antics.js). Where it looks is gaze.js; this file puts it on the map and moves its head.
//
// It can be picked up and put down anywhere on the globe. On land it stays (until the page is
// loaded again: then it is back in Canada). In the sea it goes under with a splash and swims
// home (roam.js), walking where the way crosses land; it can be picked up again on the way.
//
// The head turns by layers that move by different amounts (ears least, the muzzle most), from
// --gx and --gy (the gaze, -1..1) on the element; the CSS (.mascot in styles.css) animates it,
// the act that is playing (data-antic) and what it is doing otherwise (data-state: held,
// splash, swim, walk). The walk goes by --wx and --wy: how far the U.S. is.

import { createGaze, gazeToward } from './gaze.js';
import { createAntics } from './antics.js';
import { character, DEFAULT_CHARACTER } from './characters.js';
import { tripMs, along, isDrag } from './roam.js';

export const HOME = [-79.4, 45.4];     // lon, lat: north of Toronto, inside Canada at any size
export const WALK_TO = [-80.5, 38.5];  // where it walks to and back: West Virginia, in the U.S.
const SIZE = 0.62;                      // the drawings are about 100 units tall: 62px at full size
const WALK_MAX = 240;                   // px on screen: zoomed in, it doesn't walk off the view
const SPLASH_MS = 700;                  // as long as the plunge in styles.css
const LAND_CHECK_MS = 160;              // on the way home: how often it asks whether it is on land

// The sea around it while it swims: a waterline and a ripple. What is under water is cut off
// (the clip, used by the CSS on the body), so nothing of the map is covered.
const WATER = `
<clipPath id="mascot-dry"><rect x="-70" y="-220" width="140" height="190"/></clipPath>
<path d="M-30-30Q-22.5-35-15-30T0-30T15-30T30-30" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="1.8" stroke-linecap="round"/>
<ellipse class="mascot-ring" cx="0" cy="-30" rx="30" ry="6" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1.4"/>`;

/**
 * Put the mascot on the map. lookAt({ placeIds, markerId }) turns it towards a selection
 * (nothing: back to the east). A click on it plays an act, to the end (antics.js); a drag moves
 * it; put down on a place, onPlace(placeId) is told. setCharacter(id) changes who stands there.
 * `raf` and `now` are injectable for tests.
 */
export function createMascot(map, { home = HOME, walkTo = WALK_TO, character: first = DEFAULT_CHARACTER, onPlace = () => {}, doc = document,
  raf = (fn) => requestAnimationFrame(fn), cancelRaf = (h) => cancelAnimationFrame(h), now = () => performance.now() } = {}) {
  const pin = map.pin(home[0], home[1]);
  // The drawing sits in a group of its own, which the walk moves (the element keeps its scale).
  pin.innerHTML = `<g class="mascot" aria-hidden="true" transform="scale(${SIZE})"><g class="mascot-walk"><g class="mascot-body"></g><g class="mascot-water">${WATER}</g></g></g>`;
  const el = pin.firstElementChild;
  const body = el.querySelector('.mascot-body');
  let who = null;
  let at = home;          // where it stands now
  let lastTarget = {};

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

  /** How far the walk goes, in the drawing's units: as far as the U.S. is from its home, as the map shows it now. */
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

  // ---- picked up, put down, and the way home from the sea
  const setState = (state) => { if (state) el.dataset.state = state; else delete el.dataset.state; };
  const moveTo = (lonLat) => { at = lonLat; map.movePin(pin, lonLat[0], lonLat[1]); };
  const placeHere = () => map.placeAt(at[0], at[1]);
  const onLand = () => placeHere() != null;
  let trip = null;        // the way home: { frame } or { timer } (the splash before it)
  function endTrip() {
    if (!trip) return;
    cancelRaf(trip.frame);
    clearTimeout(trip.timer);
    trip = null;
  }
  /** Home from where it is, in a straight line on the map: swimming at sea, walking over land. */
  function goHome() {
    const from = map.projection(at), to = map.projection(home);
    const ms = tripMs(Math.hypot(to[0] - from[0], to[1] - from[1]) * map.transform.k);
    const t0 = now();
    let checked = -Infinity;
    const step = () => {
      const t = now();
      const f = (t - t0) / ms;
      moveTo(f >= 1 ? home : map.projection.invert(along(from, to, f)));
      if (f >= 1) { trip = null; setState(null); api.lookAt(lastTarget); return; }
      if (t - checked >= LAND_CHECK_MS) { checked = t; setState(onLand() ? 'walk' : 'swim'); }
      trip.frame = raf(step);
    };
    trip = { frame: raf(step) };
  }
  /** Put down where it is: on land it stays, and the place is told; in the sea it goes under, then swims home. */
  function drop() {
    const place = placeHere();
    if (place) { setState(null); api.lookAt(lastTarget); onPlace(place); return; }
    setState('splash');
    trip = { timer: setTimeout(goHome, SPLASH_MS) };
  }

  let press = null;       // { id, x, y, dx, dy, held }: a pointer down on it
  let dragged = false;    // the click that follows a drag is not a click
  // Not the map's: no pan starts under it, and the press is its own.
  for (const type of ['mousedown', 'touchstart']) el.addEventListener(type, (event) => event.stopPropagation(), { passive: true });
  el.addEventListener('pointerdown', (event) => {
    if (event.button) return;
    event.stopPropagation();
    const feet = map.screenOf(at[0], at[1]);
    const box = map.box();
    // On its way home it is taken out of the water at once; standing, only when it is dragged.
    const held = trip != null;
    endTrip();
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: feet[0] - (event.clientX - box.left), dy: feet[1] - (event.clientY - box.top), held };
    if (held) setState('held');
    el.setPointerCapture?.(event.pointerId);
  });
  el.addEventListener('pointermove', (event) => {
    if (!press || event.pointerId !== press.id) return;
    if (!press.held) {
      if (!isDrag(event.clientX - press.x, event.clientY - press.y)) return;
      press.held = true;
      antics.stop();
      delete el.dataset.antic;
      setState('held');
    }
    const box = map.box();
    // Its feet follow the pointer, within the globe: off it, it stays where it last was.
    const to = map.lonLatAt(event.clientX - box.left + press.dx, event.clientY - box.top + press.dy);
    if (to) moveTo(to);
  });
  const release = (event) => {
    if (!press || event.pointerId !== press.id) return;
    const { held } = press;
    press = null;
    el.releasePointerCapture?.(event.pointerId);
    if (!held) return;
    dragged = true;
    setTimeout(() => { dragged = false; }, 0);
    drop();
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('click', (event) => {
    event.stopPropagation();
    if (dragged || el.dataset.state) return;
    antics.play();
  });

  const activity = () => gaze.activity();
  for (const type of ['pointerdown', 'keydown']) doc.addEventListener(type, activity, { capture: true, passive: true });

  const api = {
    lookAt(target = {}) {
      lastTarget = target;
      const to = map.focusPoint(target);
      // From its eyes: a fixed height on screen, so less of the map the closer the zoom.
      const [x, y] = map.projection(at);
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
      body.innerHTML = who.drawing;
      api.lookAt(lastTarget);
    },
    get character() { return who.id; },
    /** Where it stands now: [lon, lat]. */
    get position() { return at; },
    stop() {
      gaze.stop();
      antics.stop();
      endTrip();
      clearTimeout(blinkTimer);
      for (const type of ['pointerdown', 'keydown']) doc.removeEventListener(type, activity, { capture: true });
    },
  };
  api.setCharacter(first);
  return api;
}
