// Screen-space clustering of point markers (pure), and their icons. Markers whose screen
// positions fall in the same grid cell become one cluster: its position is their average,
// its level their highest, and it shows their count. Zooming in spreads them into other
// cells, so clusters split as the map is enlarged.

export const CELL = 28;   // px

/**
 * @param markers  [{ id, x, y, level, ... }] in screen pixels
 * @returns [{ id, items, x, y, level }], lowest level first (drawn first, so the highest is on top)
 */
export function clusterMarkers(markers, cell = CELL) {
  const cells = new Map();
  for (const m of markers) {
    const key = `${Math.floor(m.x / cell)}:${Math.floor(m.y / cell)}`;
    (cells.get(key) ?? cells.set(key, []).get(key)).push(m);
  }
  return [...cells.values()].map(items => {
    items.sort((a, b) => a.id.localeCompare(b.id));
    return {
      id: items.length === 1 ? items[0].id : `cluster:${items.map(m => m.id).join('|')}`,
      items,
      x: items.reduce((s, m) => s + m.x, 0) / items.length,
      y: items.reduce((s, m) => s + m.y, 0) / items.length,
      level: Math.max(...items.map(m => m.level ?? 1)),
    };
  }).sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
}

// Icons drawn in white on the marker's disc, in a box from -5 to 5 around its centre.
export const MARKER_ICONS = {
  earthquake: 'M-5 0.5H-3L-1.5-3.5L0.5 4L2-1.5L3 0.5H5',
  cyclone: 'M-4 0.5A4 4 0 0 1 0.5-3.5M4-0.5A4 4 0 0 1-0.5 3.5M0 0h0.01',
  flood: 'M-4.5-1.5q1.1-1.4 2.25 0t2.25 0t2.25 0t2.25 0M-4.5 2q1.1-1.4 2.25 0t2.25 0t2.25 0t2.25 0',
  volcano: 'M-4.5 4L-1.5-1.5H1.5L4.5 4ZM-1-3.5L-0.5-5M1-3.5L0.5-5',
  drought: 'M0-2A2 2 0 1 0 0.01-2M0-5V-3.8M0 3.8V5M-5 0H-3.8M3.8 0H5',
  wildfire: 'M0-4.5C2-2 3.2 0 2.6 2.1C2 4.2-2 4.2-2.6 2.1C-3.1 0.3-1.4-1.2 0-4.5Z',
  default: 'M0-2.5V1M0 3h0.01',
};
