// The map's mascot: a capybara explorer standing in Canada, north of Toronto (glasses, a red
// scarf, a backpack and a guide book). Decoration only: a pin on the map (world-map.js), so it
// stays at a fixed size, leaves the screen with Canada when the map is zoomed elsewhere, and
// never catches a click. Where it looks is gaze.js; this file draws it and moves its head.
//
// The head turns by layers that move by different amounts (ears least, the muzzle most), from
// --gx and --gy (the gaze, -1..1) on the element; the CSS (.mascot in styles.css) animates it.

import { createGaze, gazeToward } from './gaze.js';

export const HOME = [-79.4, 45.4];   // lon, lat: north of Toronto, inside Canada at any size
const SIZE = 0.62;                    // the drawing is 100 units tall: 62px at full size
const EYES = 88;                      // units above its feet: where it looks from

const FUR = '#c58b52', FUR_DARK = '#a8703d', LINE = '#5a3a1e';

// Drawn with its feet at (0, 0), facing the visitor.
const DRAWING = `
<g class="mascot-bob">
  <ellipse cx="0" cy="-1" rx="21" ry="3.2" fill="#000" opacity=".22"/>
  <rect x="-30" y="-71" width="21" height="9" rx="4.5" fill="#c9a46a" stroke="${LINE}" stroke-width=".8"/>
  <rect x="-29" y="-63" width="16" height="31" rx="4" fill="#8b5a2b" stroke="${LINE}" stroke-width=".8"/>
  <rect x="-12" y="-19" width="8" height="10" fill="${FUR_DARK}"/>
  <rect x="4" y="-19" width="8" height="10" fill="${FUR_DARK}"/>
  <rect x="-13.5" y="-12" width="10" height="3" rx="1" fill="#eee6d6"/>
  <rect x="3.5" y="-12" width="10" height="3" rx="1" fill="#eee6d6"/>
  <rect x="-16" y="-10" width="13" height="9" rx="3.5" fill="#6e4524" stroke="#3e2512" stroke-width=".8"/>
  <rect x="3" y="-10" width="13" height="9" rx="3.5" fill="#6e4524" stroke="#3e2512" stroke-width=".8"/>
  <path d="M-19-40H19L20-17Q20-14 17-14H4L1-25H-1L-4-14H-17Q-20-14-20-17Z" fill="#6f7744" stroke="#40461f" stroke-width=".8"/>
  <rect x="-17" y="-61" width="34" height="25" rx="9" fill="#efe4cb" stroke="#9b8a66" stroke-width=".8"/>
  <path d="M-12-60L-10-40M12-60L10-40" stroke="#7a4b25" stroke-width="3"/>
  <rect x="-19" y="-41" width="38" height="4" fill="#6e4524"/>
  <rect x="-2.6" y="-41.6" width="5.2" height="5.2" fill="none" stroke="#d6a640" stroke-width="1.1"/>
  <path d="M-8-37V-33" stroke="#d6a640" stroke-width=".8"/>
  <circle cx="-8" cy="-29" r="4.6" fill="#e2b84a" stroke="#8a6420" stroke-width=".8"/>
  <circle cx="-8" cy="-29" r="3" fill="#f6efdc"/>
  <path d="M-8-31.4L-7.2-29H-8.8Z" fill="#b5392c"/>
  <ellipse cx="-19.5" cy="-48" rx="4.4" ry="9" fill="${FUR}" stroke="${LINE}" stroke-width=".8"/>
  <g transform="rotate(-7 15 -48)">
    <rect x="7" y="-60" width="17" height="22" rx="1.6" fill="#3d5a3c" stroke="#22331f" stroke-width=".9"/>
    <path d="M10-55.5H21M10-52.5H20M10-49.5H21" stroke="#d8c98f" stroke-width="1.1"/>
    <path d="M11-41.5L14.5-46L17-43.5L18.5-45L21-41.5" fill="none" stroke="#d8c98f" stroke-width=".9"/>
  </g>
  <circle cx="9.5" cy="-46" r="3.8" fill="${FUR}" stroke="${LINE}" stroke-width=".8"/>
  <path d="M-11-61.5Q0-55 11-61.5L7-55.5Q0-51.5-7-55.5Z" fill="#b5392c" stroke="#7d2219" stroke-width=".7"/>
  <path d="M-2.2-56.5H2.2L0-49.5Z" fill="#b5392c" stroke="#7d2219" stroke-width=".7"/>
  <g class="mascot-head">
    <g class="mascot-ears">
      <ellipse cx="-11" cy="-101" rx="3.6" ry="3" fill="${FUR_DARK}" stroke="${LINE}" stroke-width=".8"/>
      <ellipse cx="11" cy="-101" rx="3.6" ry="3" fill="${FUR_DARK}" stroke="${LINE}" stroke-width=".8"/>
    </g>
    <path d="M-15-92Q-15-104-3-104H3Q15-104 15-92V-76Q17-66 12-61Q0-57-12-61Q-17-66-15-76Z" fill="${FUR}" stroke="${LINE}" stroke-width=".9"/>
    <path d="M-4-103.6Q-2.5-108-1-103.6Q.5-108.5 2-103.6Q3.5-107.5 5-103.6" fill="none" stroke="${FUR_DARK}" stroke-width="1"/>
    <g class="mascot-muzzle">
      <rect x="-11" y="-80" width="22" height="19" rx="8.5" fill="#dcab76"/>
      <rect x="-6.5" y="-79" width="13" height="4.8" rx="2.4" fill="#4a2d1a"/>
      <path d="M0-74.4V-70.6M-3.6-69.4Q0-67 3.6-69.4" fill="none" stroke="#4a2d1a" stroke-width=".9" stroke-linecap="round"/>
    </g>
    <g class="mascot-face">
      ${[-7, 7].map(x => `<g class="mascot-eye">
        <circle cx="${x}" cy="-88" r="3.1" fill="#fff"/>
        <g class="mascot-pupil"><circle cx="${x}" cy="-88" r="2" fill="#2b1a10"/><circle cx="${x - 0.6}" cy="-88.8" r=".7" fill="#fff"/></g>
      </g>
      <circle cx="${x}" cy="-88" r="5.6" fill="#fff" fill-opacity=".16" stroke="#3a2a1c" stroke-width="1.2"/>`).join('')}
      <path d="M-1.4-88.6Q0-90 1.4-88.6" fill="none" stroke="#3a2a1c" stroke-width="1.1"/>
    </g>
  </g>
</g>`;

/**
 * Draw the mascot on the map. lookAt({ placeIds, markerId }) turns it towards a selection
 * (nothing: back to the east).
 */
export function createMascot(map, { home = HOME, doc = document } = {}) {
  const pin = map.pin(home[0], home[1]);
  pin.innerHTML = `<g class="mascot" aria-hidden="true" transform="scale(${SIZE})">${DRAWING}</g>`;
  const el = pin.firstElementChild;

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
  const activity = () => gaze.activity();
  for (const type of ['pointerdown', 'keydown']) doc.addEventListener(type, activity, { capture: true, passive: true });

  return {
    lookAt(target = {}) {
      const to = map.focusPoint(target);
      // From its eyes: a fixed height on screen, so less of the map the closer the zoom.
      const [x, y] = map.projection(home);
      gaze.setTarget(to ? gazeToward([x, y - (EYES * SIZE * map.pinScale) / map.transform.k], to) : null);
    },
    stop() {
      gaze.stop();
      clearTimeout(blinkTimer);
      for (const type of ['pointerdown', 'keydown']) doc.removeEventListener(type, activity, { capture: true });
    },
  };
}
