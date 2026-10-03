// Which country names to draw on the zoomed-in map: the largest places first, each name kept
// clear of the others, of the map's edges and of its insets (the mode switch on top, the legend
// below). Pure: the map gives each place's screen position, its area on screen and its name.

/**
 * @param candidates  [{ key, x, y, area, text }]: the label's centre on screen, the place's
 *                    area on screen (px²) and its name
 * @param opts  { width, height, top, bottom, charWidth, lineHeight, pad, minArea, max, first, firstMinArea }
 *              top and bottom: px kept clear; a label's box is estimated from its length;
 *              first: the key of a place (the selected one) named before all others, and from
 *              a smaller area (firstMinArea), so a small country that was clicked gets its name
 * @returns [{ key, x, y, text }]  the labels to draw: `first`, then the largest place first
 */
export function placeLabels(candidates, { width, height, top = 0, bottom = 0, charWidth = 7, lineHeight = 14, pad = 2, minArea = 1600, max = 80, first = null, firstMinArea = minArea }) {
  const placed = [];
  const boxes = [];
  const fits = (b) => b.x0 >= 0 && b.x1 <= width && b.y0 >= top && b.y1 <= height - bottom;
  const hits = (b) => boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  const lead = (c) => c.key === first;
  const named = candidates.filter(x => x.text && x.area >= (lead(x) ? firstMinArea : minArea)).sort((a, b) => lead(b) - lead(a) || b.area - a.area);
  for (const c of named) {
    if (placed.length >= max) break;
    const w = c.text.length * charWidth / 2 + pad;
    const h = lineHeight / 2 + pad;
    const box = { x0: c.x - w, x1: c.x + w, y0: c.y - h, y1: c.y + h };
    if (!fits(box) || hits(box)) continue;
    boxes.push(box);
    placed.push({ key: c.key, x: c.x, y: c.y, text: c.text });
  }
  return placed;
}

/**
 * The least zoom, from `from` up, that draws a place's name once the place is in the middle of
 * the view (or as near to it as the map's edges allow): a clicked country zooms in just so far.
 * @param places  [{ key, x, y, area, text }] at zoom 1: each place's centre and area (px²)
 * @param opts    { key, from, max, step, minZoom } and placeLabels()'s options (the place is its `first`);
 *                clamp(k, x, y) -> [x, y]: the translation the map allows at zoom k (default: as asked)
 * @returns { k, x, y }: the zoom and its translation, or null when no zoom up to `max` shows the name
 */
export function labelZoom(places, { key, from = 1, max = 24, step = 1.25, minZoom = 1, clamp = (k, x, y) => [x, y], ...opts }) {
  const target = places.find(p => p.key === key);
  if (!target?.text || !(target.area > 0)) return null;
  opts = { ...opts, first: key };
  // No name below minZoom, or while the place is smaller than its name needs.
  let k = Math.min(max, Math.max(from, minZoom, Math.sqrt((opts.firstMinArea ?? opts.minArea ?? 1600) / target.area)));
  for (;;) {
    const [x, y] = clamp(k, opts.width / 2 - k * target.x, opts.height / 2 - k * target.y);
    const shown = placeLabels(places.map(p => ({ ...p, x: p.x * k + x, y: p.y * k + y, area: p.area * k * k })), opts);
    if (shown.some(l => l.key === key)) return { k, x, y };
    if (k >= max) return null;
    k = Math.min(max, k * step);
  }
}
