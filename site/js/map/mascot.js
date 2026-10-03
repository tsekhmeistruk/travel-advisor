// The map's mascot: an explorer standing on the map (a capybara, or the goose: characters.js has
// the drawings, and the visitor picks one). Decoration only: a pin on the map (world-map.js), so
// it stays at a fixed size and leaves the screen with its place when the map is zoomed elsewhere.
// A click on it never reaches the map: it does a small act instead (antics.js). Where it looks
// is gaze.js; this file puts it on the map and moves it.
//
// Its home is the visitor's country (main.js guesses it, core/locate.js; Canada if it can't).
// It gets about (roam.js has the times):
//   - picked up (a drag, or a press held a moment: its legs dangle) and put down anywhere on the
//     globe. On land it stays, and the place is told (onPlace). In the sea it goes under with a
//     splash and swims home, walking where the way crosses land;
//   - sent to a point (goTo(): a country the visitor clicked): it walks there quickly, and
//     where the way crosses the sea a boat appears under it, and goes again on the other shore;
//   - on any way it can be picked up again.
// Where it comes to rest is told (onRest), so the page can keep it for the session.
//
// The head turns by layers that move by different amounts (ears least, the muzzle most), from
// --gx and --gy (the gaze, -1..1) on the element; the CSS (.mascot in styles.css) animates it,
// the act that is playing (data-antic) and what it is doing otherwise (data-state: held,
// splash, swim, walk, boat). The walk goes by --wx and --wy: how far the U.S. is from Canada.

import { createGaze, gazeToward } from './gaze.js';
import { createAntics } from './antics.js';
import { character, DEFAULT_CHARACTER } from './characters.js';
import { planTrip, tripAt, along, isDrag, wayLength, HOLD_MS, QUICK, HOMEWARD } from './roam.js';

export const HOME = [-79.4, 45.4];     // lon, lat: north of Toronto, inside Canada at any size
const WALK_FROM = HOME, WALK_TO = [-80.5, 38.5];   // the walk act is as long as from there to West Virginia
const SIZE = 0.62;                      // the drawings are about 100 units tall: 62px at full size
const WALK_MAX = 240;                   // px on screen: zoomed in, it doesn't walk off the view
const STANDING_ON = 24;                 // px on screen from its feet: the chosen place is under it
const SPLASH_MS = 700;                  // as long as the plunge in styles.css
const SAMPLE_PX = 6;                    // a way is planned from a look at the map this often along it (px on screen)

// The sea around it while it swims: a waterline and a ripple. What is under water is cut off
// (the clip, used by the CSS on the body), so nothing of the map is covered.
const WATER = `
<clipPath id="mascot-dry"><rect x="-70" y="-220" width="140" height="190"/></clipPath>
<path d="M-30-30Q-22.5-35-15-30T0-30T15-30T30-30" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="1.8" stroke-linecap="round"/>
<ellipse class="mascot-ring" cx="0" cy="-30" rx="30" ry="6" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="1.4"/>`;
// The boat it crosses the sea in: a hull in front of its legs, on a line of water.
const BOAT = `
<g class="mascot-hull">
  <path d="M-36-25H36Q31-4 21-2H-21Q-31-4-36-25Z" fill="#a9743f" stroke="#5a3a1e" stroke-width="1" stroke-linejoin="round"/>
  <path d="M-34-19H34M-31-12H31" stroke="#7a4b25" stroke-width="1.1"/>
  <path d="M-42-3Q-31.5-8-21-3T0-3T21-3T42-3" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="1.8" stroke-linecap="round"/>
</g>`;

/**
 * Put the mascot on the map.
 * @param opts.home      [lon, lat] where it lives: where it swims back to
 * @param opts.start     [lon, lat] where it stands at first (default: its home)
 * @param opts.onPlace(placeId)   it was put down on this place
 * @param opts.onRest([lon, lat] | null)   it came to rest there (null: at home)
 * @returns lookAt({ placeIds, markerId }) turns it towards a selection (nothing: back to the
 *   east); goTo([lon, lat]) sends it there; setCharacter(id) changes who it is.
 * `raf`, `cancelRaf` and `now` are injectable for tests.
 */
export function createMascot(map, { home = HOME, start = home, character: first = DEFAULT_CHARACTER, onPlace = () => {}, onRest = () => {}, doc = document,
  raf = (fn) => requestAnimationFrame(fn), cancelRaf = (h) => cancelAnimationFrame(h), now = () => performance.now() } = {}) {
  const pin = map.pin(start[0], start[1]);
  // The drawing sits in a group of its own, which the walk moves (the element keeps its scale).
  pin.innerHTML = `<g class="mascot" aria-hidden="true" transform="scale(${SIZE})"><g class="mascot-walk"><g class="mascot-body"></g><g class="mascot-boat">${BOAT}</g><g class="mascot-water">${WATER}</g></g></g>`;
  const el = pin.firstElementChild;
  const body = el.querySelector('.mascot-body');
  let who = null;
  let at = start;         // where it stands now
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

  /** How far the walk act goes, in the drawing's units: as far as the U.S. is from Canada, as the map shows it now. */
  function walkBy() {
    const from = map.projection(WALK_FROM), to = map.projection(WALK_TO);
    let dx = (to[0] - from[0]) * map.transform.k, dy = (to[1] - from[1]) * map.transform.k;
    const far = Math.hypot(dx, dy);
    if (far > WALK_MAX) { dx *= WALK_MAX / far; dy *= WALK_MAX / far; }
    const unit = SIZE * map.pinScale;
    return [dx / unit, dy / unit];
  }
  // A click is the mascot's own: the map below is not selected.
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
  const endAct = () => { antics.stop(); delete el.dataset.antic; };

  // ---- getting about
  const setState = (state) => { if (state) el.dataset.state = state; else delete el.dataset.state; };
  const moveTo = (lonLat) => { at = lonLat; map.movePin(pin, lonLat[0], lonLat[1]); };
  const placeHere = () => map.placeAt(at[0], at[1]);
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  /** It stands still again: the gaze from where it is, and the page is told where. */
  function rest() {
    setState(null);
    api.lookAt(lastTarget);
    onRest(same(at, home) ? null : at);
  }
  let trip = null;        // a way it is on: { frame }, or { timer } (the splash before the swim)
  function endTrip() {
    if (!trip) return;
    cancelRaf(trip.frame);
    clearTimeout(trip.timer);
    trip = null;
  }
  /**
   * To a point, in a straight line on the map: on foot over land, by `sea` ("swim" or "boat")
   * across water. The way is planned first (roam.js): where it is land and where sea, so each
   * stretch has its own pace and the boat is there in time.
   */
  function travel(to, { sea, pace }) {
    endTrip();
    const from = map.projection(at), end = map.projection(to);
    const projected = Math.hypot(end[0] - from[0], end[1] - from[1]);
    // The look at the map is as fine as the screen shows it; the time is the same at any zoom.
    const n = Math.max(1, Math.min(400, Math.ceil((projected * map.transform.k) / SAMPLE_PX)));
    const land = Array.from({ length: n }, (_, i) => {
      const [lon, lat] = map.projection.invert(along(from, end, (i + 0.5) / n));
      return map.placeAt(lon, lat) != null;
    });
    const plan = planTrip(land, wayLength(projected, map.projection.scale()), pace);
    const t0 = now();
    const step = () => {
      const here = tripAt(plan, now() - t0);
      moveTo(here.done ? to : map.projection.invert(along(from, end, here.f)));
      if (here.done) { trip = null; rest(); return; }
      setState(here.land ? 'walk' : sea);
      trip.frame = raf(step);
    };
    trip = { frame: raf(step) };
  }
  /** Put down where it is: on land it stays, and the place is told; in the sea it goes under, then swims home. */
  function drop() {
    const place = placeHere();
    if (place) { rest(); onPlace(place); return; }
    setState('splash');
    trip = { timer: setTimeout(() => travel(home, { sea: 'swim', pace: HOMEWARD }), SPLASH_MS) };
  }

  let press = null;       // { id, x, y, dx, dy, held, timer }: a pointer down on it
  let dragged = false;    // the click that follows a lift is not a click
  /** Lifted off the map: whatever it was doing ends, and its legs dangle. */
  function lift() {
    if (!press || press.held) return;
    press.held = true;
    endAct();
    setState('held');
  }
  // Not the map's: no pan starts under it, and the press is its own.
  for (const type of ['mousedown', 'touchstart']) el.addEventListener(type, (event) => event.stopPropagation(), { passive: true });
  el.addEventListener('pointerdown', (event) => {
    if (event.button) return;
    event.stopPropagation();
    const feet = map.screenOf(at[0], at[1]);
    const box = map.box();
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: feet[0] - (event.clientX - box.left), dy: feet[1] - (event.clientY - box.top), held: false };
    // On a way it is lifted at once; standing, when it is dragged or the press is held a moment.
    if (trip) { endTrip(); lift(); } else press.timer = setTimeout(lift, HOLD_MS);
    el.setPointerCapture?.(event.pointerId);
  });
  el.addEventListener('pointermove', (event) => {
    if (!press || event.pointerId !== press.id) return;
    if (!press.held) {
      if (!isDrag(event.clientX - press.x, event.clientY - press.y)) return;
      lift();
    }
    const box = map.box();
    // Its feet follow the pointer, within the globe: off it, it stays where it last was.
    const to = map.lonLatAt(event.clientX - box.left + press.dx, event.clientY - box.top + press.dy);
    if (to) moveTo(to);
  });
  const release = (event) => {
    if (!press || event.pointerId !== press.id) return;
    const { held, timer } = press;
    clearTimeout(timer);
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
      // Standing on what is chosen (it walked there, or was put there), there is nothing to turn to: it looks at the visitor.
      const eyes = to && Math.hypot(to[0] - x, to[1] - y) * map.transform.k < STANDING_ON ? to : [x, y - (who.eyes * SIZE * map.pinScale) / map.transform.k];
      gaze.setTarget(to ? gazeToward(eyes, to) : null);
    },
    /** Send it to a point: quickly, on foot, and by boat where the way crosses the sea. Not while it is held. */
    goTo(lonLat) {
      if (!lonLat || press?.held || same(lonLat, at)) return;
      endAct();
      travel(lonLat, { sea: 'boat', pace: QUICK });
    },
    /** Who it is: an id of characters.js (unknown: the first). An act that is playing ends. */
    setCharacter(id) {
      const next = character(id);
      if (next === who) return;
      who = next;
      endAct();
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
      clearTimeout(press?.timer);
      clearTimeout(blinkTimer);
      for (const type of ['pointerdown', 'keydown']) doc.removeEventListener(type, activity, { capture: true });
    },
  };
  api.setCharacter(first);
  return api;
}
