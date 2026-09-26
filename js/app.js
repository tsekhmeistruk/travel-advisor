(() => {
  'use strict';

  const DATA = window.ADVISORY_DATA;
  const TOPO = window.WORLD_TOPO;

  const RECENT_OPTIONS = [0, 7, 30, 90];
  const DAY = 864e5;
  const DOT_AREA = 14;          // px² at zoom 1; smaller shapes also get a hoverable dot
  const STORAGE_KEY = 'travel-risk-map:settings';

  // Polygons the base map merges into one country but that have their own advisory.
  // Each rule claims the polygons whose bounding-box centre passes the test.
  const SPLITS = {
    'Palestine': [
      { name: 'Gaza', test: ([x]) => x < 34.6 },
      { name: 'West Bank', test: () => true },
    ],
    'France': [
      { name: 'French Guiana', test: ([x, y]) => x < -50 && y > 0 && y < 7 },
      { name: 'Martinique', test: ([x, y]) => x > -61.4 && x < -60.6 && y > 14 && y < 15 },
      { name: 'Guadeloupe', test: ([x, y]) => x > -62 && x < -61 && y > 15.7 && y < 16.7 },
      { name: 'Réunion', test: ([x, y]) => x > 55 && y < -20 },
      { name: 'Mayotte', test: ([x, y]) => x > 44 && x < 46 && y < -12 },
    ],
    'Portugal': [
      { name: 'Azores', test: ([x, y]) => x < -24 && y > 36 },
    ],
    'Spain': [
      { name: 'Canary Islands', test: ([, y]) => y < 30 },
    ],
    'Netherlands': [
      { name: 'Bonaire', test: ([x, y]) => x < -68 && y < 13 },
      { name: 'Saba and Sint Eustatius', test: ([x, y]) => x > -63.5 && x < -62.5 && y > 17 },
    ],
  };

  const DISPLAY_NAMES = {
    'United States of America': 'United States',
    'W. Sahara': 'Western Sahara',
    'N. Cyprus': 'Northern Cyprus',
    'Faeroe Is.': 'Faroe Islands',
    'U.S. Virgin Is.': 'U.S. Virgin Islands',
    'N. Mariana Is.': 'Northern Mariana Islands',
    'Falkland Is.': 'Falkland Islands',
    'Fr. S. Antarctic Lands': 'French Southern and Antarctic Lands',
    'S. Geo. and the Is.': 'South Georgia & South Sandwich Is.',
    'Br. Indian Ocean Ter.': 'British Indian Ocean Territory',
    'Indian Ocean Ter.': 'Australian Indian Ocean Territories',
    'Heard I. and McDonald Is.': 'Heard Island and McDonald Islands',
    'Ashmore and Cartier Is.': 'Ashmore and Cartier Islands',
    'Cook Is.': 'Cook Islands',
    'Pitcairn Is.': 'Pitcairn Islands',
    'Wallis and Futuna Is.': 'Wallis and Futuna',
    'St. Pierre and Miquelon': 'Saint Pierre and Miquelon',
  };

  const $ = (id) => document.getElementById(id);

  if (!DATA || !TOPO || !window.d3 || !window.topojson) {
    document.body.innerHTML = '<p style="padding:24px;font-family:system-ui">Map data failed to load. Run <code>node scripts/build-data.mjs</code> and reload.</p>';
    return;
  }

  // ---------- Dates ----------
  const today = startOfDay(new Date());
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function parseDay(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
  function ageDays(iso) { return Math.max(0, Math.round((today - parseDay(iso)) / DAY)); }
  const fmtDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  function formatDate(iso) { return fmtDate.format(parseDay(iso)); }
  function relativeAge(days) {
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 45) return `${days} days ago`;
    const months = Math.round(days / 30.44);
    if (months < 18) return `${months} months ago`;
    const years = Math.round(days / 365.25 * 10) / 10;
    return `${years} years ago`;
  }
  function shortAge(days) {
    if (days === 0) return 'today';
    if (days < 45) return `${days}d ago`;
    return `${Math.round(days / 30.44)}mo ago`;
  }

  // ---------- Settings ----------
  const defaults = { source: 'us', levels: [1, 2, 3, 4], recentDays: 30, dimOthers: false, theme: 'auto', panelOpen: true };
  const settings = loadSettings();

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const s = { ...defaults, ...saved };
      if (!Array.isArray(s.levels)) s.levels = defaults.levels.slice();
      if (!RECENT_OPTIONS.includes(s.recentDays)) s.recentDays = defaults.recentDays;
      if (!DATA.sources[s.source]) s.source = defaults.source;
      return s;
    } catch {
      return { ...defaults, levels: defaults.levels.slice() };
    }
  }
  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  }

  // Recent = level change we observed in the window, or a real (not bulk-republish)
  // "last updated" date in the window.
  function isRecent(advisory) {
    if (!advisory || settings.recentDays === 0) return false;
    if (advisory.levelChange && ageDays(advisory.levelChange.date) <= settings.recentDays) return true;
    return !advisory.minorUpdate && ageDays(advisory.updated) <= settings.recentDays;
  }

  // The date that makes an advisory "recent", for sorting and pulse strength.
  function recentDate(a) {
    if (a.levelChange && ageDays(a.levelChange.date) <= settings.recentDays) return a.levelChange.date;
    return a.updated;
  }

  // ---------- Regions: map shapes joined with the active source's advisories ----------
  const features = splitFeatures(topojson.feature(TOPO, TOPO.objects.countries).features);

  // Shapes are fixed; which advisory each one shows depends on the source.
  const shapeRegions = features.map((feature, i) => ({
    key: `f${i}`,
    mapName: feature.properties.name,
    feature,
    main: largestPolygon(feature),
  }));

  let SRC;                         // active source: { label, agency, levels, advisories, ... }
  let LEVELS;
  let regions = [];                // shapeRegions + this source's point/list-only regions
  let regionByAdvisory = new Map(); // advisory name -> the region that represents it

  function assignSource(key) {
    SRC = DATA.sources[key];
    LEVELS = SRC.levels;
    const byName = new Map(SRC.advisories.map(a => [a.name, a]));
    const byShape = new Map();
    for (const a of SRC.advisories) for (const s of a.shapes || []) byShape.set(s, a);
    const territories = new Set(SRC.territories);

    for (const r of shapeRegions) {
      const direct = byShape.get(r.mapName);
      // An advisory spanning several shapes (e.g. Canada's "Israel and Palestine")
      // shows each shape under its own name, as covered by that advisory.
      const shared = direct && direct.shapes.length > 1;
      const coveringName = shared ? direct.name : SRC.coveredBy[r.mapName];
      r.advisory = direct || (coveringName ? byName.get(coveringName) : null);
      r.coveredBy = direct && !shared ? null : coveringName || null;
      r.name = direct && !shared ? direct.name : (DISPLAY_NAMES[r.mapName] || r.mapName);
      r.kind = r.advisory ? 'advisory'
        : r.mapName === SRC.home ? 'home'
        : territories.has(r.mapName) ? 'territory' : 'none';
    }

    regions = shapeRegions.slice();
    // Advisories with no shape in the map: a dot (point) or list/search only.
    for (const a of SRC.advisories) {
      if (a.shapes) continue;
      regions.push({ key: `${key}-${a.name}`, mapName: a.name, name: a.name, feature: null, main: null,
        point: a.point || null, advisory: a, coveredBy: null, kind: 'advisory' });
    }

    regionByAdvisory = new Map();
    for (const a of SRC.advisories) {
      const first = a.shapes ? shapeRegions.find(r => r.mapName === a.shapes[0]) : regions.find(r => r.advisory === a);
      if (first) regionByAdvisory.set(a.name, first);
    }
  }

  function splitFeatures(input) {
    const out = [];
    for (const f of input) {
      const rules = SPLITS[f.properties.name];
      if (!rules) { out.push(f); continue; }
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const groups = new Map();
      const rest = [];
      for (const poly of polys) {
        const c = bboxCenter(poly[0]);
        const rule = rules.find(rl => rl.test(c));
        if (!rule) { rest.push(poly); continue; }
        if (!groups.has(rule.name)) groups.set(rule.name, []);
        groups.get(rule.name).push(poly);
      }
      if (rest.length) out.push(makeFeature(f.properties.name, rest, f.id));
      for (const [name, g] of groups) out.push(makeFeature(name, g));
    }
    return out;
  }
  function makeFeature(name, polys, id) {
    return { type: 'Feature', id, properties: { name }, geometry: { type: 'MultiPolygon', coordinates: polys } };
  }
  function bboxCenter(ring) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  }
  // Largest polygon, used for label points and zoom bounds so that
  // far-flung islands don't drag the centre into the ocean.
  function largestPolygon(f) {
    if (f.geometry.type === 'Polygon') return f;
    let best = null, bestArea = -1;
    for (const coords of f.geometry.coordinates) {
      const g = { type: 'Polygon', coordinates: coords };
      const a = d3.geoArea(g);
      if (a > bestArea) { bestArea = a; best = g; }
    }
    return { type: 'Feature', properties: f.properties, geometry: best };
  }

  // ---------- SVG scaffold ----------
  const mapArea = $('mapArea');
  const svg = d3.select('#map');
  const defs = svg.append('defs');
  const shadow = defs.append('filter').attr('id', 'lift')
    .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    .append('feDropShadow').attr('dx', 0).attr('dy', 1).attr('stdDeviation', 2).attr('flood-opacity', 0.35);

  const viewport = svg.append('g').attr('class', 'viewport');
  const spherePath = viewport.append('path').attr('class', 'sphere');
  const graticulePath = viewport.append('path').attr('class', 'graticule');
  const countryLayer = viewport.append('g').attr('class', 'countries');
  const selectOutline = viewport.append('path').attr('class', 'select-outline');
  const hoverOutline = viewport.append('path').attr('class', 'hover-outline');
  const overlay = svg.append('g').attr('class', 'overlay');
  const dotLayer = overlay.append('g').attr('class', 'dots');
  const pulseLayer = overlay.append('g').attr('class', 'pulses');

  const projection = d3.geoNaturalEarth1();
  const path = d3.geoPath(projection);
  // Frame the populated latitudes (Antarctica stays reachable by panning down).
  const fitOutline = {
    type: 'MultiPoint',
    coordinates: d3.range(-180, 181, 5).flatMap(lon => [[lon, -57], [lon, 84], [lon, 0]]),
  };

  assignSource(settings.source);

  const countryPaths = countryLayer.selectAll('path')
    .data(shapeRegions, r => r.key)
    .join('path')
    .attr('class', 'country');
  bindPointer(countryPaths);

  let width = 0, height = 0;
  let transform = d3.zoomIdentity;
  let hovered = null;
  let selected = null;

  const zoom = d3.zoom()
    .scaleExtent([1, 24])
    .on('zoom', (event) => { transform = event.transform; applyTransform(); });
  svg.call(zoom).on('dblclick.zoom', null);
  svg.on('click', (event) => {
    if (event.target === svg.node() || event.target.classList.contains('sphere') || event.target.classList.contains('graticule')) {
      select(null);
    }
  });

  function layout() {
    const rect = mapArea.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    svg.attr('width', width).attr('height', height);

    const pad = width < 600 ? 8 : 24;
    const bottom = $('legend').offsetHeight + 24;   // keep the map clear of the legend
    projection.fitExtent([[pad, pad], [width - pad, height - bottom]], fitOutline);

    spherePath.attr('d', path({ type: 'Sphere' }));
    graticulePath.attr('d', path(d3.geoGraticule10()));
    countryPaths.attr('d', r => path(r.feature));
    computeAnchors();

    const [[sx0, sy0], [sx1, sy1]] = path.bounds({ type: 'Sphere' });
    zoom.extent([[0, 0], [width, height]])
      .translateExtent([[Math.min(0, sx0), Math.min(0, sy0)], [Math.max(width, sx1), Math.max(height, sy1)]]);
    transform = d3.zoomIdentity;
    svg.call(zoom.transform, transform);

    renderDots();
    renderPulses();
    updateOutlines();
    applyTransform();
  }

  // Screen position (at zoom 1) and size of every region, for dots, pulses and zoom.
  function computeAnchors() {
    for (const r of regions) {
      if (r.feature) {
        r.areaPx = path.area(r.feature);
        r.anchor = projection(d3.geoCentroid(r.main));
      } else if (r.point) {
        r.areaPx = 0;
        r.anchor = projection(r.point);
      } else {
        r.anchor = null;
      }
    }
  }

  function applyTransform() {
    viewport.attr('transform', transform);
    shadow.attr('stdDeviation', 2 / transform.k).attr('dy', 1 / transform.k);
    const place = (sel) => sel.attr('transform', r => `translate(${transform.applyX(r.anchor[0])},${transform.applyY(r.anchor[1])})`);
    place(dotLayer.selectAll('.dot'));
    place(pulseLayer.selectAll('.pulse'));
    // Once a tiny shape is big enough to hover directly, retire its dot.
    dotLayer.selectAll('.dot').attr('display', r => (r.feature && r.areaPx * transform.k * transform.k > DOT_AREA * 4) ? 'none' : null);
  }

  // ---------- Painting ----------
  function levelClass(r) {
    const lvl = r.advisory?.level;
    if (!lvl) return 'none';
    return settings.levels.includes(lvl) ? `l${lvl}` : 'muted';
  }
  function stateClasses(r, base) {
    const lvl = r.advisory?.level;
    let c = `${base} ${lvl ? `l${lvl}` : 'none'}`;
    if (lvl && !settings.levels.includes(lvl)) c += ' is-muted';
    if (settings.dimOthers && settings.recentDays > 0 && !isRecent(r.advisory)) c += ' is-dim';
    if (r.mapName === 'Antarctica') c += ' is-polar';   // huge on the projection, rarely relevant
    if (base === 'dot' && r === hovered) c += ' is-hover';
    if (base === 'dot' && r === selected) c += ' is-selected';
    return c;
  }

  function paint() {
    countryPaths.attr('class', r => stateClasses(r, 'country'));
    dotLayer.selectAll('.dot').attr('class', r => stateClasses(r, 'dot'));
    renderPulses();
    applyTransform();
    updateOutlines();
    renderLegend();
    renderSettings();
    renderRecent();
    renderDetails();
  }

  function renderDots() {
    // Only places with their own advisory get a dot; tiny no-advisory islands would just add noise.
    const dotRegions = regions.filter(r => r.anchor && r.advisory && !r.coveredBy
      && (r.point || (r.feature && r.areaPx < DOT_AREA)));
    const dots = dotLayer.selectAll('.dot')
      .data(dotRegions, r => r.key)
      .join('circle')
      .attr('r', 3.2)
      .attr('class', r => stateClasses(r, 'dot'));
    bindPointer(dots);
  }

  function renderPulses() {
    const list = settings.recentDays > 0
      ? [...regionByAdvisory.values()].filter(r => r.anchor && isRecent(r.advisory) && settings.levels.includes(r.advisory.level))
      : [];
    pulseLayer.selectAll('.pulse')
      .data(list, r => r.key)
      .join(enter => {
        const g = enter.append('g').attr('class', 'pulse');
        g.append('circle').attr('class', 'ring').attr('r', 6);
        g.append('circle').attr('class', 'core').attr('r', 3);
        return g;
      })
      // Fresher updates are more prominent; stagger animations so they don't pulse in lockstep.
      .attr('opacity', r => 0.45 + 0.55 * (1 - ageDays(recentDate(r.advisory)) / settings.recentDays))
      .each(function (r, i) { this.firstChild.style.animationDelay = `${-(i * 0.37) % 2.4}s`; });
  }

  function updateOutlines() {
    const outline = (sel, r) => {
      if (r && r.feature) sel.attr('d', path(r.feature)).attr('display', null);
      else sel.attr('display', 'none');
    };
    outline(hoverOutline, hovered);
    if (hovered) hoverOutline.attr('class', `hover-outline ${levelClass(hovered)}`);
    outline(selectOutline, selected);
    dotLayer.selectAll('.dot')
      .classed('is-hover', r => r === hovered)
      .classed('is-selected', r => r === selected);
  }

  // ---------- Interaction ----------
  const tooltip = $('tooltip');

  function bindPointer(sel) {
    sel.on('pointerenter', (event, r) => { setHover(r); if (event.pointerType === 'mouse') showTooltip(event, r); })
      .on('pointermove', (event, r) => { if (event.pointerType === 'mouse') positionTooltip(event); })
      .on('pointerleave', () => { setHover(null); hideTooltip(); })
      .on('click', (event, r) => { event.stopPropagation(); select(selected === r ? null : r); });
  }

  function setHover(r) {
    if (hovered === r) return;
    hovered = r;
    updateOutlines();
    renderDetails();
    highlightRecentItem();
  }

  function select(r, { zoomTo = false } = {}) {
    selected = r;
    updateOutlines();
    renderDetails();
    highlightRecentItem();
    if (r && zoomTo) zoomToRegion(r);
  }

  function zoomToRegion(r) {
    let x0, y0, x1, y1;
    if (r.main) {
      [[x0, y0], [x1, y1]] = path.bounds(r.main);
    } else if (r.anchor) {
      [x0, y0, x1, y1] = [r.anchor[0] - 6, r.anchor[1] - 6, r.anchor[0] + 6, r.anchor[1] + 6];
    } else {
      return;
    }
    const k = Math.max(1, Math.min(10, 0.55 / Math.max((x1 - x0) / width, (y1 - y0) / height)));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    svg.transition().duration(750).ease(d3.easeCubicInOut)
      .call(zoom.transform, d3.zoomIdentity.translate(width / 2 - k * cx, height / 2 - k * cy).scale(k));
  }

  $('zoomIn').onclick = () => svg.transition().duration(300).call(zoom.scaleBy, 1.6);
  $('zoomOut').onclick = () => svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.6);
  $('zoomReset').onclick = () => svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity);

  function showTooltip(event, r) {
    const a = r.advisory;
    const when = a && (a.levelChange ? `Level ${a.levelChange.from} → ${a.levelChange.to} ${relativeAge(ageDays(a.levelChange.date))}`
      : `${a.minorUpdate ? 'Minor edit' : 'Updated'} ${relativeAge(ageDays(a.updated))}`);
    const level = a
      ? `<div class="tt-row"><span class="swatch" style="background:var(--l${a.level})"></span>Level ${a.level} · ${LEVELS[a.level].short}</div>
         ${when ? `<div class="tt-row">${when}</div>` : ''}`
      : `<div class="tt-row">No advisory</div>`;
    tooltip.innerHTML = `<strong>${esc(r.name)}</strong>${level}`;
    tooltip.hidden = false;
    positionTooltip(event);
  }
  function positionTooltip(event) {
    const rect = mapArea.getBoundingClientRect();
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let x = event.clientX - rect.left + 14;
    let y = event.clientY - rect.top + 14;
    if (x + tw > rect.width - 8) x = event.clientX - rect.left - tw - 14;
    if (y + th > rect.height - 8) y = event.clientY - rect.top - th - 14;
    tooltip.style.transform = `translate(${x}px, ${y}px)`;
    tooltip.style.left = '0';
    tooltip.style.top = '0';
  }
  function hideTooltip() { tooltip.hidden = true; }

  // ---------- Panel: details ----------
  const details = $('details');

  function renderDetails() {
    const r = hovered || selected;
    details.innerHTML = r ? regionDetails(r) : overview();
  }

  function overview() {
    const counts = [1, 2, 3, 4].map(l => SRC.advisories.filter(a => a.level === l).length);
    const total = SRC.advisories.length;
    const recentCount = settings.recentDays > 0 ? SRC.advisories.filter(isRecent).length : 0;
    return `
      <div class="eyebrow">World overview · ${esc(SRC.label)}</div>
      <h3>${total} advisories</h3>
      <div class="stack" aria-hidden="true">
        ${[4, 3, 2, 1].map(l => `<span style="--c:var(--l${l});flex:${counts[l - 1]}"></span>`).join('')}
      </div>
      <div class="overview-grid">
        ${[4, 3, 2, 1].map(l => `<div><span class="swatch" style="background:var(--l${l})"></span>${LEVELS[l].short}<b>${counts[l - 1]}</b></div>`).join('')}
      </div>
      ${settings.recentDays > 0 ? `<p><strong>${recentCount}</strong> updated in the last ${settings.recentDays} days, marked with a pulse on the map.</p>` : ''}
      <p class="hint">Hover or tap a country for details.</p>`;
  }

  function regionDetails(r) {
    const a = r.advisory;
    if (!a) {
      const reason = r.kind === 'home'
        ? `The ${esc(SRC.agency)} issues advisories for travel outside ${r.mapName === 'Canada' ? 'Canada' : 'the United States'}.`
        : r.kind === 'territory'
          ? 'U.S. territory. No travel advisory is issued.'
          : 'There is no advisory for this place in the current data.';
      return `
        <div class="eyebrow">No advisory</div>
        ${title(r.name)}
        <span class="badge" style="--c:var(--land-none)"><span class="swatch"></span>No level</span>
        <p class="desc">${reason}</p>`;
    }
    // Every advisory card has the same slots in the same order, so the card
    // (and the panel below it) doesn't shift as the pointer moves between countries.
    const days = ageDays(a.updated);
    const L = LEVELS[a.level];
    const change = a.levelChange;
    const status = [
      change ? `<span class="fresh ${change.to > change.from ? 'up' : 'down'}" title="Level ${change.from} → ${change.to} on ${formatDate(change.date)}">Level ${change.from} → ${change.to} · ${formatDate(change.date)}</span>`
        : isRecent(a) ? `<span class="fresh" title="Updated in the last ${settings.recentDays} days">Recently updated</span>` : '',
      a.regional ? '<span class="tag" title="Some areas of this destination have a different, often higher, risk level">Regional advisories</span>' : '',
      a.note ? `<span class="note" title="${esc(a.note)}">${esc(a.note)}</span>` : '',
    ].join('');
    const url = a.url || SRC.link;
    return `
      <div class="eyebrow">${r.coveredBy ? `Covered by ${esc(r.coveredBy)}` : 'Travel advisory'}</div>
      ${title(r.name)}
      <span class="badge" style="--c:var(--l${a.level})"><span class="swatch"></span>Level ${a.level} · ${L.name}</span>
      <div class="scale" style="--c:var(--l${a.level})" aria-hidden="true">
        ${[1, 2, 3, 4].map(l => `<span class="${l <= a.level ? 'on' : ''}"></span>`).join('')}
      </div>
      <p class="desc">${L.desc}</p>
      <dl class="meta">
        <div><dt>Last updated</dt><dd>${formatDate(a.updated)} · ${relativeAge(days)}</dd></div>
      </dl>
      ${changeBlock(a)}
      <div class="status">${status}</div>
      <a class="link" href="${esc(url)}" target="_blank" rel="noopener">Read the advisory on ${new URL(url).hostname} ↗</a>`;
  }

  // "What changed" in the latest update, as published by the source. Fixed height:
  // long notes are clamped, with the full text on hover.
  function changeBlock(a) {
    const minor = a.minorUpdate
      ? `<span class="minor-tag" title="${a.change ? 'Wording or routine edit only; nothing about the risk changed' : 'Date shared by most of this source\'s advisories: a site-wide republish, not a content change'}">${a.change ? 'Minor edit' : 'Site-wide republish'}</span>`
      : '';
    const text = a.change
      ? `<p class="change-text" title="${esc(a.change)}">${esc(a.change)}</p>`
      : `<p class="change-text none">${a.minorUpdate ? 'No details published for this update.' : 'The source didn’t publish a note for this update.'}</p>`;
    return `<div class="change"><div class="change-label">What changed ${minor}</div>${text}</div>`;
  }

  // One-line title; long names step down in size instead of wrapping.
  function title(name) {
    const size = name.length > 34 ? 'xlong' : name.length > 22 ? 'long' : '';
    return `<h3 class="${size}" title="${esc(name)}">${esc(name)}</h3>`;
  }

  // ---------- Panel: settings ----------
  const levelChips = $('levelChips');
  const recentSeg = $('recentSeg');
  const dimToggle = $('dimToggle');

  levelChips.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    const l = Number(btn.dataset.level);
    settings.levels = settings.levels.includes(l) ? settings.levels.filter(x => x !== l) : [...settings.levels, l].sort();
    saveSettings();
    paint();
  });

  recentSeg.innerHTML = RECENT_OPTIONS.map(d =>
    `<button role="radio" data-days="${d}">${d ? `${d} days` : 'Off'}</button>`).join('');
  recentSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    settings.recentDays = Number(btn.dataset.days);
    saveSettings();
    paint();
  });

  dimToggle.addEventListener('change', () => {
    settings.dimOthers = dimToggle.checked;
    saveSettings();
    paint();
  });

  function renderSettings() {
    // Level names differ per source, so the chips are rebuilt.
    levelChips.innerHTML = [1, 2, 3, 4].map(l =>
      `<button class="chip" data-level="${l}" style="--c:var(--l${l})" title="${esc(LEVELS[l].name)}"
        aria-pressed="${settings.levels.includes(l)}"><span class="swatch"></span>${l} · ${LEVELS[l].short}</button>`).join('');
    recentSeg.querySelectorAll('button').forEach(b =>
      b.setAttribute('aria-checked', String(Number(b.dataset.days) === settings.recentDays)));
    dimToggle.checked = settings.dimOthers;
    dimToggle.closest('.setting').classList.toggle('is-disabled', settings.recentDays === 0);
  }

  // ---------- Panel: recent list ----------
  const recentList = $('recentList');

  function renderRecent() {
    const section = recentList.closest('.recent');
    section.hidden = settings.recentDays === 0;
    if (section.hidden) return;
    const items = SRC.advisories
      .filter(a => isRecent(a) && settings.levels.includes(a.level))
      .sort((a, b) => recentDate(b).localeCompare(recentDate(a)) || b.level - a.level);
    $('recentTitle').textContent = `Updated in the last ${settings.recentDays} days`;
    $('recentCount').textContent = items.length;
    recentList.innerHTML = items.length
      // A change feed: each entry says what changed, straight from the source.
      ? items.map(a => {
        const what = a.levelChange && recentDate(a) === a.levelChange.date
          ? `Level ${a.levelChange.from} → ${a.levelChange.to}${a.change ? ` · ${a.change}` : ''}`
          : a.change;
        return `
        <li><button data-name="${esc(a.name)}" title="${esc(what || `Level ${a.level} · ${LEVELS[a.level].name}`)}">
          <span class="row">
            <span class="swatch" style="--c:var(--l${a.level})"></span>
            <span class="name">${esc(a.name)}</span>
            <span class="when">${shortAge(ageDays(recentDate(a)))}</span>
          </span>
          ${what ? `<span class="what">${esc(what)}</span>` : ''}
        </button></li>`;
      }).join('')
      : '<li class="recent-empty">No advisories updated in this period.</li>';
    highlightRecentItem();
  }

  function highlightRecentItem() {
    const active = (hovered || selected)?.advisory?.name;
    recentList.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.name === active));
  }

  recentList.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    select(regionByAdvisory.get(btn.dataset.name), { zoomTo: true });
  });
  recentList.addEventListener('pointerover', (e) => {
    const btn = e.target.closest('button');
    if (btn) setHover(regionByAdvisory.get(btn.dataset.name));
  });
  recentList.addEventListener('pointerleave', () => setHover(null));

  // ---------- Search ----------
  const search = $('search');
  const results = $('searchResults');
  let searchable = [];
  // Advisories by their own name, plus map places that have no advisory.
  function buildSearchIndex() {
    searchable = [
      ...[...regionByAdvisory].map(([label, r]) => ({ r, label })),
      ...shapeRegions.filter(r => !r.advisory).map(r => ({ r, label: r.name })),
    ].map(s => ({ ...s, key: normalize(s.label) }));
  }
  let matches = [];
  let active = 0;

  function normalize(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  search.addEventListener('input', () => {
    const q = normalize(search.value.trim());
    if (!q) { closeResults(); return; }
    const starts = searchable.filter(s => s.key.startsWith(q));
    const contains = searchable.filter(s => !s.key.startsWith(q) && s.key.includes(q));
    matches = [...starts, ...contains].slice(0, 7);
    active = 0;
    renderResults();
  });
  search.addEventListener('keydown', (e) => {
    if (results.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(matches.length - 1, active + 1); renderResults(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); renderResults(); e.preventDefault(); }
    else if (e.key === 'Enter' && matches[active]) { choose(matches[active]); e.preventDefault(); }
    else if (e.key === 'Escape') closeResults();
  });
  search.addEventListener('blur', () => setTimeout(closeResults, 150));
  results.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); choose(matches[Number(li.dataset.i)]); }
  });

  function renderResults() {
    results.hidden = false;
    results.innerHTML = matches.length
      ? matches.map(({ r, label }, i) => {
        const lvl = r.advisory?.level;
        return `<li role="option" data-i="${i}" aria-selected="${i === active}">
          <span class="swatch" style="background:${lvl ? `var(--l${lvl})` : 'var(--land-none)'}"></span>
          ${esc(label)}<span class="lvl">${lvl ? `Level ${lvl}` : 'No advisory'}</span></li>`;
      }).join('')
      : '<li class="recent-empty">No matches</li>';
  }
  function closeResults() { results.hidden = true; matches = []; }
  function choose({ r }) {
    search.value = '';
    closeResults();
    search.blur();
    select(r, { zoomTo: true });
  }

  // ---------- Legend ----------
  function renderLegend() {
    $('legend').innerHTML = [1, 2, 3, 4].map(l =>
      `<span class="legend-item"><span class="swatch" style="background:var(--l${l})"></span>${LEVELS[l].short}</span>`).join('')
      + '<span class="legend-item"><span class="swatch none"></span>No advisory</span>'
      + (settings.recentDays > 0 ? `<span class="legend-item"><span class="legend-pulse"></span>Updated ≤ ${settings.recentDays} days</span>` : '');
  }

  // ---------- Theme & panel ----------
  const THEME_ICONS = {
    auto: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    dark: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  };
  const THEME_ORDER = ['auto', 'light', 'dark'];
  const themeBtn = $('themeToggle');

  function applyTheme() {
    if (settings.theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.theme;
    themeBtn.innerHTML = THEME_ICONS[settings.theme];
    themeBtn.title = `Theme: ${settings.theme}`;
  }
  themeBtn.onclick = () => {
    settings.theme = THEME_ORDER[(THEME_ORDER.indexOf(settings.theme) + 1) % THEME_ORDER.length];
    saveSettings();
    applyTheme();
  };

  function applyPanel() {
    $('app').classList.toggle('panel-collapsed', !settings.panelOpen);
    $('panelOpen').hidden = settings.panelOpen;
  }
  $('panelClose').onclick = () => { settings.panelOpen = false; saveSettings(); applyPanel(); };
  $('panelOpen').onclick = () => { settings.panelOpen = true; saveSettings(); applyPanel(); };

  // ---------- Source switch (U.S. / Canada) ----------
  const FLAGS = {
    us: `<svg class="flag" viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#fff"/>${
      d3.range(0, 13, 2).map(i => `<rect y="${(i * 16 / 13).toFixed(2)}" width="24" height="${(16 / 13).toFixed(2)}" fill="#b22234"/>`).join('')
    }<rect width="10" height="8.62" fill="#3c3b6e"/>${
      d3.cross(d3.range(4), d3.range(3)).map(([c, rw]) => `<circle cx="${1.4 + c * 2.4}" cy="${1.5 + rw * 2.8}" r=".5" fill="#fff"/>`).join('')
    }</svg>`,
    ca: `<svg class="flag" viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="16" fill="#fff"/>
      <rect width="6" height="16" fill="#d52b1e"/><rect x="18" width="6" height="16" fill="#d52b1e"/>
      <path fill="#d52b1e" d="M12 2.4l.9 1.7 1-.5-.4 2.7 1.5-1.3.4.9 1.3-.3-.5 1.5.7.4-2.5 2.1.4 1.1-2.5-.4.05 3.1h-.7l.05-3.1-2.5.4.4-1.1-2.5-2.1.7-.4-.5-1.5 1.3.3.4-.9 1.5 1.3-.4-2.7 1 .5z"/></svg>`,
  };
  const SHORT_LABELS = { us: 'U.S.', ca: 'Canada' };
  const sourceToggle = $('sourceToggle');
  const sourceKeys = Object.keys(DATA.sources);

  sourceToggle.innerHTML = '<span class="thumb" aria-hidden="true"></span>' + sourceKeys.map(k =>
    `<button role="radio" data-source="${k}" title="${esc(DATA.sources[k].agency)} advisories">${FLAGS[k] || ''}<span>${SHORT_LABELS[k] || esc(DATA.sources[k].label)}</span></button>`).join('');
  sourceToggle.style.setProperty('--n', sourceKeys.length);
  sourceToggle.hidden = sourceKeys.length < 2;
  sourceToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-source]');
    if (btn && btn.dataset.source !== settings.source) switchSource(btn.dataset.source);
  });

  function renderSourceToggle() {
    sourceToggle.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.source === settings.source)));
    sourceToggle.style.setProperty('--i', sourceKeys.indexOf(settings.source));
  }

  function renderSourceText() {
    const days = ageDays(SRC.asOf);
    $('asOf').textContent = `${SRC.agency} advisories · data as of ${formatDate(SRC.asOf)}${days > 7 ? ` (${relativeAge(days)})` : ''}`;
    $('sourceLink').href = SRC.link;
    $('sourceLink').textContent = SRC.agency;
  }

  function switchSource(key) {
    settings.source = key;
    saveSettings();
    assignSource(key);
    computeAnchors();
    hovered = null;
    if (selected && !regions.includes(selected)) selected = null;
    buildSearchIndex();
    renderDots();
    renderSourceToggle();
    renderSourceText();
    paint();
  }

  // ---------- Utils ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- Boot ----------
  buildSearchIndex();
  renderSourceToggle();
  renderSourceText();
  applyTheme();
  applyPanel();
  renderLegend();   // layout() measures it
  new ResizeObserver(() => layout()).observe(mapArea);
  layout();
  paint();
})();
