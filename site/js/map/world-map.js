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
// Zoomed in (×2.5 or more), the map names the places that have room, the selected one first,
// then the largest (labels.js).
//
// Point markers (events: an earthquake, a cyclone) come from setMarkers([{ id, lon, lat, kind,
// level }]). They keep a fixed pixel size while zooming, and markers closer than a grid cell
// on screen are drawn as one cluster with a count (see clusters.js).
//
// Points come from setPoints([{ id, lon, lat, r, dim }]) or, at a place's centre, with placeId
// instead of lon and lat: plain circles of a fixed pixel size, never clustered, under the labels
// and markers.
//
// Pins (pin(lon, lat)) are <g> elements the caller draws in, kept at a point and a fixed pixel
// size (pinScale: scaled down on a small map, less than the points), under everything else and
// out of the pointer's way unless the drawing asks for it: decoration, such as the capybara in
// Canada (mascot.js), which takes its own clicks.
//
// Subdivisions (opts.subdivisions: lines of [lon, lat]) are the borders inside countries, between
// states and provinces: one thin path over the countries, out of the pointer's way.
//
// Needs d3 and topojson-client as globals (loaded by index.html).

import { splitFeatures } from './splits.js';
import { clusterMarkers, MARKER_ICONS } from './clusters.js';
import { placeLabels, labelZoom } from './labels.js';

const DOT_AREA = 14;             // px² at zoom 1; smaller shapes also get a hoverable dot
const POLAR = new Set(['aq']);   // drawn faded: huge on this projection, rarely relevant
const MAX_ZOOM = 24;
const LABEL_ZOOM = 2.5;          // names from this zoom on
const LABEL_AREA = 1600;         // px² on screen a place needs for its name
const SELECTED_LABEL_AREA = 400; // the selected place: named first, and from a smaller size

export class WorldMap {
  /**
   * @param opts.svg, opts.container   the <svg> and its sized container
   * @param opts.topo                  world-atlas topology
   * @param opts.places                place registry
   * @param opts.subdivisions          borders inside countries: [[[lon, lat], …], …] (default: none)
   * @param opts.bottomInset()         px to keep clear at the bottom (e.g. the legend)
   * @param opts.topInset()            px to keep clear at the top (e.g. the mode switch)
   * @param opts.labelFor(placeId)      a place's name, for the labels when zoomed in (none: no labels)
   * @param opts.labelInsets()         { top, bottom } px the labels keep clear (default: the insets above)
   * @param opts.onHover(region|null, event), opts.onMove(event), opts.onSelect(region|null)
   * @param opts.onMarkerHover(cluster|null, event), opts.onMarkerSelect(cluster)
   *   a cluster is { id, items: [markers], x, y, level }; one marker is a cluster of one
   * @param opts.onPointHover(point|null, event), opts.onPointSelect(point)
   */
  constructor({ svg, container, topo, places, subdivisions = [], bottomInset = () => 0, topInset = () => 0, labelFor = () => null, labelInsets = null, onHover = () => {}, onMove = () => {}, onSelect = () => {}, onMarkerHover = () => {}, onMarkerSelect = () => {}, onPointHover = () => {}, onPointSelect = () => {} }) {
    const { d3, topojson } = globalThis;
    this.d3 = d3;
    this.container = container;
    this.bottomInset = bottomInset;
    this.topInset = topInset;
    this.labelFor = labelFor;
    this.labelInsets = labelInsets ?? (() => ({ top: this.topInset() + 16, bottom: this.bottomInset() + 16 }));
    this.handlers = { onHover, onMove, onSelect, onMarkerHover, onMarkerSelect, onPointHover, onPointSelect };
    this.markers = [];
    this.points = [];
    this.pins = [];
    this.selectedMarker = null;
    this.shownLabels = new Set();
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
    // Over the hovered country, which is drawn again, filled and lifted: its grid stays.
    this.subdivisions = { type: 'MultiLineString', coordinates: subdivisions };
    this.subdivisionPath = this.viewport.append('path').attr('class', 'subdivisions');
    this.selectOutline = this.viewport.append('path').attr('class', 'select-outline');
    const overlay = this.svg.append('g').attr('class', 'overlay');
    this.pinLayer = overlay.append('g').attr('class', 'pins');
    this.dotLayer = overlay.append('g').attr('class', 'dots');
    this.pointLayer = overlay.append('g').attr('class', 'points');
    this.labelLayer = overlay.append('g').attr('class', 'labels');   // under the markers
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
  setSelected(placeId) { this.selected = placeId ? this.region(placeId) : null; this.#updateOutlines(); this.#renderLabels(); }

  /** Point markers: [{ id, lon, lat, kind, level }]; [] removes them. */
  setMarkers(markers) {
    this.markers = markers.map(m => ({ ...m, xy: this.projection([m.lon, m.lat]) }));
    this.#renderMarkers();
  }
  /** Points: [{ id, lon, lat, r, dim }] or [{ id, placeId, r, dim }] (at the place's centre); [] removes them. */
  setPoints(points) {
    this.points = points.map(p => ({ ...p, xy: this.#pointXY(p) })).filter(p => p.xy);
    this.#renderPoints();
  }
  #pointXY(p) { return p.placeId ? this.region(p.placeId)?.anchor ?? null : this.projection([p.lon, p.lat]); }
  /** A <g> kept at this point (see the header comment), for the caller to draw in. */
  pin(lon, lat) {
    const pin = { lon, lat, xy: this.projection([lon, lat]), g: this.pinLayer.append('g') };
    this.pins.push(pin);
    this.#placePins();
    return pin.g.node();
  }
  /** Move a pin (the <g> pin() gave) to another point. */
  movePin(node, lon, lat) {
    const pin = this.pins.find(p => p.g.node() === node);
    if (!pin) return;
    Object.assign(pin, { lon, lat, xy: this.projection([lon, lat]) });
    this.#placePins();
  }
  /** The map's box on the page (for a pointer's place on it). */
  box() { return this.svg.node().getBoundingClientRect(); }
  /** Where a point of the globe is on the map now: [x, y] px from the map's corner. */
  screenOf(lon, lat) { return this.transform.apply(this.projection([lon, lat])); }
  /** The [lon, lat] under a point of the map (px from its corner), or null when that is off the globe. */
  lonLatAt(x, y) {
    const p = this.transform.invert([x, y]);
    const at = this.projection.invert(p);
    if (!at?.every(Number.isFinite) || Math.abs(at[0]) > 180 || Math.abs(at[1]) > 90) return null;
    const back = this.projection(at);
    return Math.hypot(back[0] - p[0], back[1] - p[1]) < 0.5 ? at : null;
  }
  /** The middle of a place: [lon, lat] of its main shape's centre, or its point; null if unknown. */
  centreOf(placeId) {
    const r = this.region(placeId);
    return r ? (r.main ? this.d3.geoCentroid(r.main) : r.point) : null;
  }
  /** The place whose shape has this point of the globe, or null: the sea. */
  placeAt(lon, lat) {
    // Only the shapes whose box has the point are asked: this is called many times for a way.
    const inBox = (r) => {
      const [[w, s], [e, n]] = (r.bounds ??= this.d3.geoBounds(r.feature));
      return lat >= s && lat <= n && (w <= e ? lon >= w && lon <= e : lon >= w || lon <= e);
    };
    return this.regions.find(r => r.feature && inBox(r) && this.d3.geoContains(r.feature, [lon, lat]))?.key ?? null;
  }
  /** Where a selection is on the map (projected, before the zoom): its marker, else the middle of its places; null if neither is shown. */
  focusPoint({ placeIds = [], markerId = null } = {}) {
    const marker = markerId ? this.markers.find(m => m.id === markerId) : null;
    if (marker?.xy) return marker.xy;
    const at = placeIds.map(id => this.region(id)?.anchor).filter(Boolean);
    return at.length ? [at.reduce((s, p) => s + p[0], 0) / at.length, at.reduce((s, p) => s + p[1], 0) / at.length] : null;
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

  zoomTo(placeId) { this.zoomToPlaces([placeId]); }
  /** Whether the place's name is on the map now. */
  hasLabel(placeId) { return this.shownLabels.has(placeId); }
  /**
   * Make the place's name show: nothing if it does already; else zoom in, as little as it takes
   * (labelZoom()), with the place in the middle. A place whose name never fits (a small island,
   * a point) is fitted in the view instead.
   */
  showLabel(placeId) {
    const region = this.region(placeId);
    if (!region || this.hasLabel(placeId)) return;
    const fit = labelZoom(this.#labelPlaces(), {
      key: placeId, from: this.transform.k, max: MAX_ZOOM, minZoom: LABEL_ZOOM, minArea: LABEL_AREA, firstMinArea: SELECTED_LABEL_AREA,
      width: this.width, height: this.height, ...this.labelInsets(),
      clamp: (k, x, y) => { const t = this.#clamp(this.d3.zoomIdentity.translate(x, y).scale(k)); return [t.x, t.y]; },
    });
    if (!fit) return this.zoomTo(placeId);
    this.svg.transition().duration(750).ease(this.d3.easeCubicInOut)
      .call(this.zoom.transform, this.d3.zoomIdentity.translate(fit.x, fit.y).scale(fit.k));
  }
  /** zoom.transform doesn't keep to the pan limits: this does. */
  #clamp(t) { return this.zoom.constrain()(t, [[0, 0], [this.width, this.height]], this.zoom.translateExtent()); }
  /** Each place that can have a name, at zoom 1: its centre, its area and its name. */
  #labelPlaces() {
    return this.regions.filter(r => r.feature && r.anchor).map(r => ({ key: r.key, x: r.anchor[0], y: r.anchor[1], area: r.areaPx, text: (r.label ??= this.labelFor(r.key)) }));
  }
  /** Fit these places (their main shape, or their point) in the view; unknown ones are skipped. */
  zoomToPlaces(placeIds) {
    const boxes = placeIds.map(id => this.region(id)).filter(Boolean).map(r => (r.main ? this.path.bounds(r.main)
      : r.anchor ? [[r.anchor[0] - 6, r.anchor[1] - 6], [r.anchor[0] + 6, r.anchor[1] + 6]] : null)).filter(Boolean);
    if (!boxes.length) return;
    const x0 = Math.min(...boxes.map(b => b[0][0])), y0 = Math.min(...boxes.map(b => b[0][1]));
    const x1 = Math.max(...boxes.map(b => b[1][0])), y1 = Math.max(...boxes.map(b => b[1][1]));
    const k = Math.max(1, Math.min(10, 0.55 / Math.max((x1 - x0) / this.width, (y1 - y0) / this.height)));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    // zoom.transform doesn't keep to the pan limits: clamp, so a place too big to zoom into
    // (Russia, or a war across continents) doesn't push the world off the screen.
    const t = this.#clamp(this.d3.zoomIdentity.translate(this.width / 2 - k * cx, this.height / 2 - k * cy).scale(k));
    this.svg.transition().duration(750).ease(this.d3.easeCubicInOut).call(this.zoom.transform, t);
  }
  /** Centre a shown marker (an event) at zoom 3 or more. False when no marker has this id. */
  zoomToMarker(id) {
    const m = this.markers.find(x => x.id === id);
    if (!m?.xy) return false;
    const k = Math.min(MAX_ZOOM, Math.max(3, this.transform.k));
    this.svg.transition().duration(750).ease(this.d3.easeCubicInOut)
      .call(this.zoom.transform, this.d3.zoomIdentity.translate(this.width / 2 - k * m.xy[0], this.height / 2 - k * m.xy[1]).scale(k));
    return true;
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
    this.subdivisionPath.attr('d', this.subdivisions.coordinates.length ? this.path(this.subdivisions) : null);
    for (const r of this.regions) {
      r.areaPx = r.feature ? this.path.area(r.feature) : 0;
      r.anchor = r.feature ? this.projection(this.d3.geoCentroid(r.main)) : this.projection(r.point);
    }
    for (const m of this.markers) m.xy = this.projection([m.lon, m.lat]);
    for (const p of this.points) p.xy = this.#pointXY(p) ?? p.xy;
    for (const p of this.pins) p.xy = this.projection([p.lon, p.lat]);
    // Points shrink with a small map (a phone): half their size at 450px wide.
    this.pointScale = Math.max(0.5, Math.min(1, this.width / 900));
    this.pinScale = Math.max(0.7, this.pointScale);

    const [[sx0, sy0], [sx1, sy1]] = this.path.bounds({ type: 'Sphere' });
    this.zoom.extent([[0, 0], [this.width, this.height]])
      .translateExtent([[Math.min(0, sx0), Math.min(0, sy0)], [Math.max(this.width, sx1), Math.max(this.height, sy1)]]);
    const p = keep?.at && this.projection(keep.at);
    this.transform = p?.every(Number.isFinite)
      ? this.d3.zoomIdentity.translate(this.width / 2 - keep.k * p[0], this.height / 2 - keep.k * p[1]).scale(keep.k)
      : this.d3.zoomIdentity;
    this.svg.call(this.zoom.transform, this.transform);   // clamped to the new extent
    this.#renderPoints();
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
  /** Names of the places with room for one, once zoomed in (in screen space, like the markers). */
  #renderLabels() {
    const t = this.transform;
    const list = t.k < LABEL_ZOOM ? [] : placeLabels(
      this.#labelPlaces().map(p => ({ ...p, x: t.applyX(p.x), y: t.applyY(p.y), area: p.area * t.k * t.k })),
      { width: this.width, height: this.height, ...this.labelInsets(), minArea: LABEL_AREA, first: this.selected?.key ?? null, firstMinArea: SELECTED_LABEL_AREA },
    );
    this.shownLabels = new Set(list.map(d => d.key));
    this.labelLayer.selectAll('text')
      .data(list, d => d.key)
      .join('text')
      .attr('class', 'map-label')
      .attr('x', d => d.x)
      .attr('y', d => d.y)
      .text(d => d.text);
  }

  #renderPoints() {
    const sel = this.pointLayer.selectAll('.point')
      .data(this.points, p => p.id)
      .join('circle')
      .attr('class', p => `point${p.dim ? ' is-dim' : ''}`)
      .attr('r', p => p.r * (this.pointScale ?? 1));
    sel.on('pointerenter', (event, p) => this.handlers.onPointHover(p, event))
      .on('pointermove', (event) => this.handlers.onMove(event))
      .on('pointerleave', (event) => this.handlers.onPointHover(null, event))
      .on('click', (event, p) => { event.stopPropagation(); this.handlers.onPointSelect(p); });
    this.#placePoints();
  }

  #placePoints() {
    const t = this.transform;
    this.pointLayer.selectAll('.point').attr('cx', p => t.applyX(p.xy[0])).attr('cy', p => t.applyY(p.xy[1]));
  }

  #placePins() {
    const t = this.transform;
    for (const p of this.pins) p.g.attr('transform', `translate(${t.applyX(p.xy[0])},${t.applyY(p.xy[1])}) scale(${this.pinScale ?? 1})`);
  }

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
    this.#placePoints();
    this.#placePins();
    this.#renderLabels();
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
