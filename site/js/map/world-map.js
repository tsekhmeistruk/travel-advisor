// A reusable world map of places. It knows nothing about any dataset: it draws the places in
// the registry and asks a style function how each one should look. Datasets supply that
// function, so the same map can show travel advisories today and other data later.
//
//   style(placeId) -> {
//     cls:   CSS class for the fill, e.g. 'l3' or 'none'
//     muted: true to draw it in the muted colour (filtered out)
//     dim:   true to fade it
//     dot:   true to draw a hoverable dot when the place is too small to see
//     pulse: null, or 0..1 opacity of an animated "recently changed" marker
//   }
//
// Needs d3 and topojson-client as globals (loaded by index.html).

import { splitFeatures } from './splits.js';

const DOT_AREA = 14;             // px² at zoom 1; smaller shapes also get a hoverable dot
const POLAR = new Set(['aq']);   // drawn faded: huge on this projection, rarely relevant

export class WorldMap {
  /**
   * @param opts.svg, opts.container   the <svg> and its sized container
   * @param opts.topo                  world-atlas topology
   * @param opts.places                place registry
   * @param opts.bottomInset()         px to keep clear at the bottom (e.g. the legend)
   * @param opts.onHover(region|null, event), opts.onMove(event), opts.onSelect(region|null)
   */
  constructor({ svg, container, topo, places, bottomInset = () => 0, onHover = () => {}, onMove = () => {}, onSelect = () => {} }) {
    const { d3, topojson } = globalThis;
    this.d3 = d3;
    this.container = container;
    this.bottomInset = bottomInset;
    this.handlers = { onHover, onMove, onSelect };
    this.style = () => ({ cls: 'none' });
    this.hovered = null;
    this.selected = null;
    this.transform = d3.zoomIdentity;

    // Regions: one per place, with its shape (or point) on the map.
    const features = splitFeatures(topojson.feature(topo, topo.objects.countries).features);
    const featureByShape = new Map(features.map(f => [f.properties.name, f]));
    this.regions = places.map(place => {
      const feature = place.shape ? featureByShape.get(place.shape) : null;
      return { key: place.id, place, mapName: place.shape ?? null, feature, main: feature ? largestPolygon(d3, feature) : null, point: place.point ?? null };
    }).filter(r => r.feature || r.point);
    this.byId = new Map(this.regions.map(r => [r.key, r]));

    // Layers, bottom to top. Selection sits above hover so a click shows while hovering.
    this.svg = d3.select(svg);
    const defs = this.svg.append('defs');
    this.shadow = defs.append('filter').attr('id', 'lift')
      .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
      .append('feDropShadow').attr('dx', 0).attr('dy', 1).attr('stdDeviation', 2).attr('flood-opacity', 0.35);
    this.viewport = this.svg.append('g').attr('class', 'viewport');
    this.spherePath = this.viewport.append('path').attr('class', 'sphere');
    this.graticulePath = this.viewport.append('path').attr('class', 'graticule');
    const countryLayer = this.viewport.append('g').attr('class', 'countries');
    this.hoverOutline = this.viewport.append('path').attr('class', 'hover-outline');
    this.selectOutline = this.viewport.append('path').attr('class', 'select-outline');
    const overlay = this.svg.append('g').attr('class', 'overlay');
    this.dotLayer = overlay.append('g').attr('class', 'dots');
    this.pulseLayer = overlay.append('g').attr('class', 'pulses');

    this.projection = d3.geoNaturalEarth1();
    this.path = d3.geoPath(this.projection);
    // Frame the populated latitudes (Antarctica stays reachable by panning down).
    this.fitOutline = { type: 'MultiPoint', coordinates: d3.range(-180, 181, 5).flatMap(lon => [[lon, -57], [lon, 84], [lon, 0]]) };

    this.countryPaths = countryLayer.selectAll('path')
      .data(this.regions.filter(r => r.feature), r => r.key)
      .join('path')
      .attr('class', 'country');
    this.#bindPointer(this.countryPaths);

    this.zoom = d3.zoom()
      .scaleExtent([1, 24])
      // By default any movement between press and release counts as a drag and swallows the
      // click; allow normal hand jitter so a click on a place always selects it.
      .clickDistance(6)
      .on('zoom', (event) => { this.transform = event.transform; this.#applyTransform(); });
    this.svg.call(this.zoom).on('dblclick.zoom', null);
    this.svg.on('click', (event) => {
      const cls = event.target.classList;
      if (event.target === svg || cls.contains('sphere') || cls.contains('graticule')) this.handlers.onSelect(null);
    });

    new ResizeObserver(() => this.layout()).observe(container);
    this.layout();
  }

  // ---- public API

  /** Set how places look (see the header comment) and repaint. */
  setStyle(style) { this.style = style; this.repaint(); }

  region(placeId) { return this.byId.get(placeId) ?? null; }

  setHovered(placeId) { this.hovered = placeId ? this.region(placeId) : null; this.#updateOutlines(); }
  setSelected(placeId) { this.selected = placeId ? this.region(placeId) : null; this.#updateOutlines(); }

  zoomTo(placeId) {
    const r = this.region(placeId);
    if (!r) return;
    let x0, y0, x1, y1;
    if (r.main) [[x0, y0], [x1, y1]] = this.path.bounds(r.main);
    else if (r.anchor) [x0, y0, x1, y1] = [r.anchor[0] - 6, r.anchor[1] - 6, r.anchor[0] + 6, r.anchor[1] + 6];
    else return;
    const k = Math.max(1, Math.min(10, 0.55 / Math.max((x1 - x0) / this.width, (y1 - y0) / this.height)));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    this.svg.transition().duration(750).ease(this.d3.easeCubicInOut)
      .call(this.zoom.transform, this.d3.zoomIdentity.translate(this.width / 2 - k * cx, this.height / 2 - k * cy).scale(k));
  }
  zoomBy(factor) { this.svg.transition().duration(300).call(this.zoom.scaleBy, factor); }
  resetZoom() { this.svg.transition().duration(500).call(this.zoom.transform, this.d3.zoomIdentity); }

  layout() {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.svg.attr('width', this.width).attr('height', this.height);

    const pad = this.width < 600 ? 8 : 24;
    this.projection.fitExtent([[pad, pad], [this.width - pad, this.height - (this.bottomInset() + 24)]], this.fitOutline);
    this.spherePath.attr('d', this.path({ type: 'Sphere' }));
    this.graticulePath.attr('d', this.path(this.d3.geoGraticule10()));
    this.countryPaths.attr('d', r => this.path(r.feature));
    for (const r of this.regions) {
      r.areaPx = r.feature ? this.path.area(r.feature) : 0;
      r.anchor = r.feature ? this.projection(this.d3.geoCentroid(r.main)) : this.projection(r.point);
    }

    const [[sx0, sy0], [sx1, sy1]] = this.path.bounds({ type: 'Sphere' });
    this.zoom.extent([[0, 0], [this.width, this.height]])
      .translateExtent([[Math.min(0, sx0), Math.min(0, sy0)], [Math.max(this.width, sx1), Math.max(this.height, sy1)]]);
    this.transform = this.d3.zoomIdentity;
    this.svg.call(this.zoom.transform, this.transform);
    this.repaint();
  }

  repaint() {
    this.countryPaths.attr('class', r => this.#classes(r, 'country'));
    this.#renderDots();
    this.#renderPulses();
    this.#updateOutlines();
    this.#applyTransform();
  }

  // ---- internals

  #classes(r, base) {
    const s = this.style(r.key);
    let c = `${base} ${s.cls ?? 'none'}`;
    if (s.muted) c += ' is-muted';
    if (s.dim) c += ' is-dim';
    if (POLAR.has(r.key)) c += ' is-polar';
    if (base === 'dot' && r === this.hovered) c += ' is-hover';
    if (base === 'dot' && r === this.selected) c += ' is-selected';
    return c;
  }

  #renderDots() {
    const dots = this.dotLayer.selectAll('.dot')
      .data(this.regions.filter(r => r.anchor && this.style(r.key).dot && (r.point || r.areaPx < DOT_AREA)), r => r.key)
      .join('circle')
      .attr('r', 3.2)
      .attr('class', r => this.#classes(r, 'dot'));
    this.#bindPointer(dots);
  }

  #renderPulses() {
    this.pulseLayer.selectAll('.pulse')
      .data(this.regions.filter(r => r.anchor && this.style(r.key).pulse != null), r => r.key)
      .join(enter => {
        const g = enter.append('g').attr('class', 'pulse');
        g.append('circle').attr('class', 'ring').attr('r', 6);
        g.append('circle').attr('class', 'core').attr('r', 3);
        return g;
      })
      .attr('opacity', r => this.style(r.key).pulse)
      // Stagger the animations so markers don't pulse in lockstep.
      .each(function (r, i) { this.firstChild.style.animationDelay = `${-(i * 0.37) % 2.4}s`; });
  }

  #updateOutlines() {
    const outline = (sel, r) => {
      if (r?.feature) sel.attr('d', this.path(r.feature)).attr('display', null);
      else sel.attr('display', 'none');
    };
    outline(this.hoverOutline, this.hovered);
    if (this.hovered) {
      const s = this.style(this.hovered.key);
      this.hoverOutline.attr('class', `hover-outline ${s.muted ? 'muted' : (s.cls ?? 'none')}`);
    }
    outline(this.selectOutline, this.selected);
    this.dotLayer.selectAll('.dot')
      .classed('is-hover', r => r === this.hovered)
      .classed('is-selected', r => r === this.selected);
  }

  #applyTransform() {
    const t = this.transform;
    this.viewport.attr('transform', t);
    this.shadow.attr('stdDeviation', 2 / t.k).attr('dy', 1 / t.k);
    const place = (sel) => sel.attr('transform', r => `translate(${t.applyX(r.anchor[0])},${t.applyY(r.anchor[1])})`);
    place(this.dotLayer.selectAll('.dot'));
    place(this.pulseLayer.selectAll('.pulse'));
    // Once a tiny shape is big enough to hover directly, retire its dot.
    this.dotLayer.selectAll('.dot').attr('display', r => (r.feature && r.areaPx * t.k * t.k > DOT_AREA * 4) ? 'none' : null);
  }

  #bindPointer(sel) {
    sel.on('pointerenter', (event, r) => this.handlers.onHover(r, event))
      .on('pointermove', (event) => this.handlers.onMove(event))
      .on('pointerleave', (event) => this.handlers.onHover(null, event))
      .on('click', (event, r) => { event.stopPropagation(); this.handlers.onSelect(r); });
  }
}

// Largest polygon: used for label points and zoom bounds, so far-flung islands don't drag
// the centre into the ocean.
function largestPolygon(d3, f) {
  if (f.geometry.type === 'Polygon') return f;
  let best = null, bestArea = -1;
  for (const coords of f.geometry.coordinates) {
    const g = { type: 'Polygon', coordinates: coords };
    const a = d3.geoArea(g);
    if (a > bestArea) { bestArea = a; best = g; }
  }
  return { type: 'Feature', properties: f.properties, geometry: best };
}
