// The map's characters: explorers of one kind (round glasses, a red scarf, a backpack, a guide
// book), each drawn with its feet at (0, 0), facing the visitor, about 100 units tall. mascot.js
// puts the chosen one on the map; the visitor picks it with the switch under the zoom buttons.
//
// Every drawing has the same groups, so the gaze (gaze.js) and the acts (antics.js) work for
// all of them: mascot-bob (the whole body), two mascot-leg, mascot-arm, mascot-head with mascot-ears,
// mascot-muzzle (holding mascot-nose, mascot-mouth and mascot-grin) and mascot-face (two
// mascot-eye, each with a mascot-pupil, and mascot-glasses).

const FUR = '#c58b52', FUR_DARK = '#a8703d', LINE = '#5a3a1e';
const FEATHER = '#fdfbf5', FEATHER_LINE = '#b9ad92';

const CAPYBARA = `
<g class="mascot-bob">
  <ellipse cx="0" cy="-1" rx="21" ry="3.2" fill="#000" opacity=".22"/>
  <rect x="-30" y="-71" width="21" height="9" rx="4.5" fill="#c9a46a" stroke="${LINE}" stroke-width=".8"/>
  <rect x="-29" y="-63" width="16" height="31" rx="4" fill="#8b5a2b" stroke="${LINE}" stroke-width=".8"/>
  <g class="mascot-leg">
    <rect x="-12" y="-19" width="8" height="10" fill="${FUR_DARK}"/>
    <rect x="-13.5" y="-12" width="10" height="3" rx="1" fill="#eee6d6"/>
    <rect x="-16" y="-10" width="13" height="9" rx="3.5" fill="#6e4524" stroke="#3e2512" stroke-width=".8"/>
  </g>
  <g class="mascot-leg">
    <rect x="4" y="-19" width="8" height="10" fill="${FUR_DARK}"/>
    <rect x="3.5" y="-12" width="10" height="3" rx="1" fill="#eee6d6"/>
    <rect x="3" y="-10" width="13" height="9" rx="3.5" fill="#6e4524" stroke="#3e2512" stroke-width=".8"/>
  </g>
  <path d="M-19-40H19L20-17Q20-14 17-14H4L1-25H-1L-4-14H-17Q-20-14-20-17Z" fill="#6f7744" stroke="#40461f" stroke-width=".8"/>
  <rect x="-17" y="-61" width="34" height="25" rx="9" fill="#efe4cb" stroke="#9b8a66" stroke-width=".8"/>
  <path d="M-12-60L-10-40M12-60L10-40" stroke="#7a4b25" stroke-width="3"/>
  <rect x="-19" y="-41" width="38" height="4" fill="#6e4524"/>
  <rect x="-2.6" y="-41.6" width="5.2" height="5.2" fill="none" stroke="#d6a640" stroke-width="1.1"/>
  <path d="M-8-37V-33" stroke="#d6a640" stroke-width=".8"/>
  <circle cx="-8" cy="-29" r="4.6" fill="#e2b84a" stroke="#8a6420" stroke-width=".8"/>
  <circle cx="-8" cy="-29" r="3" fill="#f6efdc"/>
  <path d="M-8-31.4L-7.2-29H-8.8Z" fill="#b5392c"/>
  <g class="mascot-arm"><ellipse cx="-19.5" cy="-48" rx="4.4" ry="9" fill="${FUR}" stroke="${LINE}" stroke-width=".8"/></g>
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
      <g class="mascot-nose"><rect x="-6.5" y="-79" width="13" height="4.8" rx="2.4" fill="#4a2d1a"/></g>
      <g fill="none" stroke="#4a2d1a" stroke-width=".9" stroke-linecap="round">
        <path d="M0-74.4V-70.6"/>
        <path class="mascot-mouth" d="M-3.6-69.4Q0-67 3.6-69.4"/>
        <path class="mascot-grin" d="M-6-70.4Q0-64.6 6-70.4"/>
      </g>
    </g>
    <g class="mascot-face">
      ${[-7, 7].map(x => `<g class="mascot-eye">
        <circle cx="${x}" cy="-88" r="3.1" fill="#fff"/>
        <g class="mascot-pupil"><circle cx="${x}" cy="-88" r="2" fill="#2b1a10"/><circle cx="${x - 0.6}" cy="-88.8" r=".7" fill="#fff"/></g>
      </g>`).join('')}
      <g class="mascot-glasses">
        ${[-7, 7].map(x => `<circle cx="${x}" cy="-88" r="5.6" fill="#fff" fill-opacity=".16" stroke="#3a2a1c" stroke-width="1.2"/>`).join('')}
        <path d="M-1.4-88.6Q0-90 1.4-88.6" fill="none" stroke="#3a2a1c" stroke-width="1.1"/>
      </g>
    </g>
  </g>
</g>`;

const GOOSE = `
<g class="mascot-bob">
  <ellipse cx="0" cy="-1" rx="21" ry="3.2" fill="#000" opacity=".22"/>
  <rect x="-34" y="-77" width="25" height="11" rx="5.5" fill="#7d8450" stroke="#40461f" stroke-width=".8"/>
  <circle cx="-28.5" cy="-71.5" r="4.4" fill="#8f856c" stroke="#4a4436" stroke-width=".8"/>
  <circle cx="-28.5" cy="-71.5" r="2" fill="none" stroke="#4a4436" stroke-width=".8"/>
  <rect x="-30" y="-67" width="17" height="34" rx="4" fill="#8b5a2b" stroke="${LINE}" stroke-width=".8"/>
  <rect x="-28" y="-47" width="8" height="9" rx="2" fill="#7a4b25" stroke="${LINE}" stroke-width=".7"/>
  <g class="mascot-leg">
    <rect x="-9.6" y="-20" width="4.2" height="11" fill="#e8962e"/>
    <rect x="-16" y="-10" width="13" height="9" rx="3.5" fill="#6e4524" stroke="#3e2512" stroke-width=".8"/>
  </g>
  <g class="mascot-leg">
    <rect x="5.4" y="-20" width="4.2" height="11" fill="#e8962e"/>
    <rect x="3" y="-10" width="13" height="9" rx="3.5" fill="#6e4524" stroke="#3e2512" stroke-width=".8"/>
  </g>
  <path d="M-19-40H19L20-19Q20-16 17-16H4L1-27H-1L-4-16H-17Q-20-16-20-19Z" fill="#6f7744" stroke="#40461f" stroke-width=".8"/>
  <rect x="-17" y="-61" width="34" height="25" rx="9" fill="#f6f1e4" stroke="#b9ad92" stroke-width=".8"/>
  <path d="M-12-60L-10-40M12-60L10-40" stroke="#7a4b25" stroke-width="3"/>
  <rect x="-19" y="-41" width="38" height="4" fill="#6e4524"/>
  <rect x="-2.6" y="-41.6" width="5.2" height="5.2" fill="none" stroke="#d6a640" stroke-width="1.1"/>
  <path d="M-8-37V-33" stroke="#d6a640" stroke-width=".8"/>
  <circle cx="-8" cy="-29" r="4.6" fill="#e2b84a" stroke="#8a6420" stroke-width=".8"/>
  <circle cx="-8" cy="-29" r="3" fill="#f6efdc"/>
  <path d="M-8-31.4L-7.2-29H-8.8Z" fill="#2f5d8a"/>
  <g class="mascot-arm"><path d="M-23.5-57Q-15-58-15-48Q-15-42-17.5-38.5L-19.5-41.5L-21.5-37.5L-23-41.5L-25-38.5Q-26.5-48-23.5-57Z" fill="${FEATHER}" stroke="${FEATHER_LINE}" stroke-width=".8" stroke-linejoin="round"/></g>
  <g transform="rotate(-7 15 -48)">
    <rect x="7" y="-60" width="17" height="22" rx="1.6" fill="#3d5a3c" stroke="#22331f" stroke-width=".9"/>
    <path d="M10-55.5H21M10-52.5H20M10-49.5H21" stroke="#d8c98f" stroke-width="1.1"/>
    <path d="M11-41.5L14.5-46L17-43.5L18.5-45L21-41.5" fill="none" stroke="#d8c98f" stroke-width=".9"/>
  </g>
  <circle cx="9.5" cy="-46" r="3.8" fill="${FEATHER}" stroke="${FEATHER_LINE}" stroke-width=".8"/>
  <rect x="-6.5" y="-90" width="13" height="32" rx="6" fill="${FEATHER}" stroke="${FEATHER_LINE}" stroke-width=".8"/>
  <path d="M-11-61.5Q0-55 11-61.5L7-55.5Q0-51.5-7-55.5Z" fill="#b5392c" stroke="#7d2219" stroke-width=".7"/>
  <path d="M-2.2-56.5H2.2L0-49.5Z" fill="#b5392c" stroke="#7d2219" stroke-width=".7"/>
  <g class="mascot-head">
    <g class="mascot-ears">
      <path d="M-2.6-108.6Q-1.6-112.4-.4-108.9Q1-113 2.4-108.6" fill="none" stroke="${FEATHER_LINE}" stroke-width="1" stroke-linecap="round"/>
    </g>
    <ellipse cx="0" cy="-97.5" rx="11.5" ry="11.8" fill="${FEATHER}" stroke="${FEATHER_LINE}" stroke-width=".9"/>
    <g class="mascot-muzzle">
      <g class="mascot-nose">
        <path d="M-7.6-90.4Q-7.6-95 0-95Q7.6-95 7.6-90.4Q7.6-85.4 0-85.4Q-7.6-85.4-7.6-90.4Z" fill="#f0a030" stroke="#b56d12" stroke-width=".8"/>
        <circle cx="-2" cy="-92.8" r=".6" fill="#8a4f0c"/><circle cx="2" cy="-92.8" r=".6" fill="#8a4f0c"/>
      </g>
      <g fill="none" stroke="#8a4f0c" stroke-width=".9" stroke-linecap="round">
        <path class="mascot-mouth" d="M-5-89.6Q0-88 5-89.6"/>
        <path class="mascot-grin" d="M-6-90.2Q0-85.6 6-90.2"/>
      </g>
    </g>
    <g class="mascot-face">
      ${[-5.5, 5.5].map(x => `<g class="mascot-eye">
        <circle cx="${x}" cy="-100.5" r="2.7" fill="#fff" stroke="#e2dccb" stroke-width=".4"/>
        <g class="mascot-pupil"><circle cx="${x}" cy="-100.5" r="1.8" fill="#2b1a10"/><circle cx="${x - 0.5}" cy="-101.2" r=".6" fill="#fff"/></g>
      </g>`).join('')}
      <g class="mascot-glasses">
        ${[-5.5, 5.5].map(x => `<circle cx="${x}" cy="-100.5" r="4.9" fill="#fff" fill-opacity=".14" stroke="#b8862b" stroke-width="1"/>`).join('')}
        <path d="M-.7-100.9Q0-101.8 .7-100.9" fill="none" stroke="#b8862b" stroke-width="1"/>
      </g>
    </g>
  </g>
</g>`;

/**
 * id: its name in the settings and the translations (mascot.<id>); eyes: units above its feet,
 * where it looks from; icon: its head, for the switch (a 24 × 24 viewBox).
 */
export const CHARACTERS = [
  {
    id: 'capybara', eyes: 88, drawing: CAPYBARA,
    icon: `<rect x="5" y="5" width="14" height="16" rx="6" fill="${FUR}" stroke="${LINE}"/><circle cx="6.5" cy="5.5" r="2" fill="${FUR_DARK}" stroke="${LINE}" stroke-width=".8"/><circle cx="17.5" cy="5.5" r="2" fill="${FUR_DARK}" stroke="${LINE}" stroke-width=".8"/><rect x="8" y="12.5" width="8" height="7" rx="3.2" fill="#dcab76"/><rect x="9.6" y="13" width="4.8" height="2" rx="1" fill="#4a2d1a"/><circle cx="9" cy="10" r="1.1" fill="#2b1a10"/><circle cx="15" cy="10" r="1.1" fill="#2b1a10"/>`,
  },
  {
    id: 'goose', eyes: 100, drawing: GOOSE,
    icon: `<rect x="9" y="12" width="6" height="10" rx="3" fill="${FEATHER}" stroke="${FEATHER_LINE}"/><ellipse cx="12" cy="9.5" rx="6.5" ry="6.5" fill="${FEATHER}" stroke="${FEATHER_LINE}"/><ellipse cx="12" cy="13" rx="4.2" ry="2.6" fill="#f0a030" stroke="#b56d12" stroke-width=".8"/><circle cx="9.2" cy="8.4" r="1.1" fill="#2b1a10"/><circle cx="14.8" cy="8.4" r="1.1" fill="#2b1a10"/>`,
  },
];
export const DEFAULT_CHARACTER = 'capybara';
export const character = (id) => CHARACTERS.find(c => c.id === id) ?? CHARACTERS[0];
