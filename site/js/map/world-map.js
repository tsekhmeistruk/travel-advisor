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
// Point markers (events: an earthquake, a cyclone) come from setMarkers([{ id, lon, lat, kind,
// level }]). They keep a fixed pixel size while zooming, and markers closer than a grid cell
// on screen are drawn as one cluster with a count (see clusters.js).
//
// Needs d3 and topojson-client as globals (loaded by index.html).

import { splitFeatures } from './splits.js';
import { clusterMarkers, MARKER_ICONS } from './clusters.js';

const DOT_AREA = 14;             // px² at zoom 1; smaller shapes also get a hoverable dot
const POLAR = new Set(['aq']);   // drawn faded: huge on this projection, rarely relevant
const MAX_ZOOM = 24;

export class WorldMap {
  /**
   * @param opts.svg, opts.container   the <svg> and its sized container
   * @param opts.topo                  world-atlas topology
   * @param opts.places                place registry
   * @param opts.bottomInset()         px to keep clear at the bottom (e.g. the legend)
   * @param opts.topInset()            px to keep clear at the top (e.g. the mode switch)
   * @param opts.onHover(region|null, event), opts.onMove(event), opts.onSelect(region|null)
   * @param opts.onMarkerHover(cluster|null, event), opts.onMarkerSelect(cluster)
   *   a cluster is { id, items: [markers], x, y, level }; one marker is a cluster of one
   */
  constructor({ svg, container, topo, places, bottomInset = () => 0, topInset = () => 0, onHover = () => {}, onMove = () => {}, onSelect = () => {}, onMarkerHover = () => {}, onMarkerSelect = () => {} }) {
    const { d3, topojson } = globalThis;
    this.d3 = d3;
    this.container = container;
    this.bottomInset = bottomInset;
    this.topInset = topInset;
    this.handlers = { onHover, onMove, onSelect, onMarkerHover, onMarkerSelect };
    this.markers = [];
    this.selectedMarker = null;
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
    this.markerLayer = overlay.append('g').attr('class', 'markers');
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
      .scaleExtent([1, MAX_ZOOM])
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

  /** Point markers: [{ id, lon, lat, kind, level }]; [] removes them. */
  setMarkers(markers) {
    this.markers = markers.map(m => ({ ...m, xy: this.projection([m.lon, m.lat]) }));
    this.#renderMarkers();
  }
  /** Highlight the marker (or the cluster holding it) with this id. */
  setSelectedMarker(id) { this.selectedMarker = id ?? null; this.#renderMarkers(); }

  /** Whether the map can zoom in further. */
  canZoomIn() { return this.transform.k < MAX_ZOOM; }

  /** Zoom in around a screen point (a cluster), keeping it under the pointer's place. */
  zoomAround(x, y, factor = 2.5) {
    const t = this.transform;
    const k = Math.min(MAX_ZOOM, t.k * factor);
    const [mx, my] = t.invert([x, y]);
    this.svg.transition().duration(500)
      .call(this.zoom.transform, this.d3.zoomIdentity.translate(this.width / 2 - k * mx, this.height / 2 - k * my).scale(k));
  }

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

  /** Fit the world to the container. On a resize, keep what was in view: its centre and the zoom. */
  layout() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    // The observer also reports the first size, which the constructor laid out already: a zoom
    // started since then (to a linked place) must not be undone.
    if (width === this.width && height === this.height) return;
    const t = this.transform;
    const keep = this.width && t.k > 1 ? { k: t.k, at: this.projection.invert(t.invert([this.width / 2, this.height / 2])) } : null;
    this.width = width;
    this.height = height;
    this.svg.attr('width', this.width).attr('height', this.height);

    const pad = this.width < 600 ? 8 : 24;
    this.projection.fitExtent([[pad, pad + this.topInset()], [this.width - pad, this.height - (this.bottomInset() + 24)]], this.fitOutline);
    this.spherePath.attr('d', this.path({ type: 'Sphere' }));
    this.graticulePath.attr('d', this.path(this.d3.geoGraticule10()));
    this.countryPaths.attr('d', r => this.path(r.feature));
    for (const r of this.regions) {
      r.areaPx = r.feature ? this.path.area(r.feature) : 0;
      r.anchor = r.feature ? this.projection(this.d3.geoCentroid(r.main)) : this.projection(r.point);
    }
    for (const m of this.markers) m.xy = this.projection([m.lon, m.lat]);

    const [[sx0, sy0], [sx1, sy1]] = this.path.bounds({ type: 'Sphere' });
    this.zoom.extent([[0, 0], [this.width, this.height]])
      .translateExtent([[Math.min(0, sx0), Math.min(0, sy0)], [Math.max(this.width, sx1), Math.max(this.height, sy1)]]);
    const p = keep?.at && this.projection(keep.at);
    this.transform = p?.every(Number.isFinite)
      ? this.d3.zoomIdentity.translate(this.width / 2 - keep.k * p[0], this.height / 2 - keep.k * p[1]).scale(keep.k)
      : this.d3.zoomIdentity;
    this.svg.call(this.zoom.transform, this.transform);   // clamped to the new extent
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

  // Markers are clustered in screen space, so this runs on every zoom step (a few dozen markers).
  #renderMarkers() {
    const t = this.transform;
    const clusters = clusterMarkers(this.markers.map(m => ({ ...m, x: t.applyX(m.xy[0]), y: t.applyY(m.xy[1]) })));
    const sel = this.markerLayer.selectAll('.marker')
      .data(clusters, c => c.id)
      .join(enter => {
        const g = enter.append('g');
        g.append('circle').attr('class', 'disc');
        g.append('path').attr('class', 'icon');
        g.append('text').attr('class', 'count');
        return g;
      })
      .attr('class', c => `marker ml${c.level}${c.items.some(m => m.id === this.selectedMarker) ? ' is-selected' : ''}`)
      .attr('transform', c => `translate(${c.x},${c.y})`);
    sel.select('.disc').attr('r', c => (c.items.length > 1 ? 9 : c.level <= 1 ? 6 : 7.5));
    sel.select('.icon').attr('d', c => (c.items.length > 1 ? null : MARKER_ICONS[c.items[0].kind] ?? MARKER_ICONS.default));
    sel.select('.count').text(c => (c.items.length > 1 ? c.items.length : ''));
    sel.on('pointerenter', (event, c) => this.handlers.onMarkerHover(c, event))
      .on('pointermove', (event) => this.handlers.onMove(event))
      .on('pointerleave', (event) => this.handlers.onMarkerHover(null, event))
      .on('click', (event, c) => { event.stopPropagation(); this.handlers.onMarkerSelect(c); });
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
    this.#renderMarkers();
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
