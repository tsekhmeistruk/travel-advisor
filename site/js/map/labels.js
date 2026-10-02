// Which country names to draw on the zoomed-in map: the largest places first, each name kept
// clear of the others, of the map's edges and of its insets (the mode switch on top, the legend
// below). Pure: the map gives each place's screen position, its area on screen and its name.

/**
 * @param candidates  [{ key, x, y, area, text }]: the label's centre on screen, the place's
 *                    area on screen (px²) and its name
 * @param opts  { width, height, top, bottom, charWidth, lineHeight, pad, minArea, max }
 *              top and bottom: px kept clear; a label's box is estimated from its length
 * @returns [{ key, x, y, text }]  the labels to draw, the largest place first
 */
export function placeLabels(candidates, { width, height, top = 0, bottom = 0, charWidth = 7, lineHeight = 14, pad = 2, minArea = 1600, max = 80 }) {
  const placed = [];
  const boxes = [];
  const fits = (b) => b.x0 >= 0 && b.x1 <= width && b.y0 >= top && b.y1 <= height - bottom;
  const hits = (b) => boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  for (const c of candidates.filter(x => x.text && x.area >= minArea).sort((a, b) => b.area - a.area)) {
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
