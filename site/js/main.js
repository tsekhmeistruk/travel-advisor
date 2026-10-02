// App entry point: loads data and language, creates the active mode's dataset and the map, and
// wires the panel. The map and panel are generic; everything mode-specific comes from the
// dataset module (see datasets/registry.js). Switching modes swaps the dataset in place: the
// map, its zoom and the selected place stay.
//
// Interaction model: a "target" is { placeId } or { recordKey }. Hovering sets a temporary
// target, clicking sets the selected one; the details card shows hovered ?? selected.
// The mode and the selected place are also kept in the URL (#mode=…&place=…), for links.

import { $ } from './core/dom.js';
import { createI18n, chooseLocale } from './core/i18n.js';
import { createSettings } from './core/settings.js';
import { createDataClient } from './core/data-client.js';
import { parseHash, formatHash } from './core/url-state.js';
import { WorldMap } from './map/world-map.js';
import { MODES, DEFAULT_MODE } from './datasets/registry.js';
import { createSearch } from './ui/search.js';
import { createProviderSwitch, createModeSwitch, createThemeToggle, createLanguagePicker, createTooltip } from './ui/controls.js';

const STORAGE_KEY = 'travel-risk-map:settings';

main().catch((err) => {
  console.error(err);
  const box = $('loadError');
  if (box) box.hidden = false;
});

async function main() {
  const client = createDataClient();
  const settings = createSettings(STORAGE_KEY, { theme: 'auto', panelOpen: true, filtersOpen: false, mode: null, locale: null });
  migrateSettings(settings);

  // ---- language
  const manifest = await client.manifest();
  const locale = chooseLocale(manifest.locales, {
    saved: settings.get('locale'), browser: navigator.languages ?? [navigator.language], fallback: manifest.defaultLocale,
  });
  const [messages, fallback, placeList, topo] = await Promise.all([
    client.messages(locale),
    locale === manifest.defaultLocale ? null : client.messages(manifest.defaultLocale),
    client.file(manifest.places),
    client.file(manifest.geo),
  ]);
  const i18n = createI18n({ locale, messages, fallback });
  document.documentElement.lang = locale;
  document.documentElement.dir = i18n.dir;
  translateStaticText(i18n);
  const names = Object.fromEntries(await Promise.all(manifest.locales.map(async code =>
    [code, code === locale ? i18n.t('meta.name') : (await client.messages(code)).meta?.name ?? code])));
  createLanguagePicker($('language'), {
    locales: manifest.locales, names, current: locale,
    onChange: (code) => { settings.set('locale', code); location.reload(); },
  });

  // ---- mode (the URL wins over the saved choice)
  const places = new Map(placeList.map(p => [p.id, p]));
  const modes = MODES.filter(m => m.entry(manifest));
  // The asked-for mode, else the saved one (an unknown mode in a link keeps the visitor's), else the default.
  const findMode = (id) => modes.find(m => m.id === id);
  const pickMode = (id) => findMode(id) ?? findMode(settings.get('mode')) ?? findMode(DEFAULT_MODE) ?? modes[0];
  // The country view comes from a risk mode; a mode without one (Travel) borrows one.
  const viewerMode = modes.find(m => m.id === 'highest');
  let borrowedViewer = null;
  const countryViewer = async () => (dataset.renderCountryView ? dataset : viewerMode ? (borrowedViewer ??= await createDataset(viewerMode)) : null);
  const createDataset = async (m) => {
    const ds = m.create({ i18n, settings, client, manifest: m.entry(manifest), places, changed: () => refresh(), countryView: !!viewerMode });
    await ds.load();
    return ds;
  };
  const fromUrl = parseHash(location.hash);
  let mode = pickMode(fromUrl.mode);
  let dataset = await createDataset(mode);

  // ---- panel and map
  let hovered = null;
  let selected = null;
  let countryOpen = false;   // the full country view replaces the card, settings and feed
  const modeSwitch = createModeSwitch($('modeSwitch'), { onChange: (id) => switchMode(id, { toUrl: true }) });
  const mapArea = $('mapArea');
  const tooltip = createTooltip($('tooltip'), mapArea);
  const search = createSearch({
    input: $('search'), results: $('searchResults'),
    noMatchesText: () => i18n.t('search.noMatches'),
    onChoose: (target) => select(target, { zoom: true, toUrl: true }),
  });
  const providerSwitch = createProviderSwitch($('providerSwitch'), {
    onChange: async (id) => {
      await dataset.setProvider(id);
      hovered = null;
      if (selected?.recordKey) selected = null;
      refresh();
    },
  });
  createThemeToggle($('themeToggle'), { settings, t: i18n.t });
  const renderModes = () => modeSwitch.render(modes.map(m => ({ id: m.id, label: i18n.t(`modes.${m.id}.label`), title: i18n.t(`modes.${m.id}.title`) })), mode.id, i18n.t('modes.label'));
  renderModes();   // measured by the map's layout, like the legend

  // The legend ends with the "How levels work" button.
  const helpButton = `<button class="legend-help" data-action="help" title="${i18n.t('help.open')}" aria-label="${i18n.t('help.open')}">
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6M12 7.5v.01" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
  </button>`;
  const renderLegend = () => { $('legend').innerHTML = dataset.legend() + helpButton; };
  renderLegend();   // measured by the map's layout
  const map = new WorldMap({
    svg: $('map'),
    container: mapArea,
    topo,
    places: placeList,
    bottomInset: () => $('legend').offsetHeight,
    // The mode switch's row (the provider switch below it may overlap the map's top edge).
    topInset: () => $('modeSwitch').offsetHeight,
    onHover: (region, event) => {
      hover(region ? { placeId: region.key } : null);
      if (region && event.pointerType === 'mouse') tooltip.show(dataset.tooltip(region.key), event);
      else tooltip.hide();
    },
    onMove: (event) => { if (event.pointerType === 'mouse') tooltip.move(event); },
    onSelect: (region) => select(region && selected?.placeId !== region.key ? { placeId: region.key } : null, { toUrl: true }),
    // A marker previews and selects its event; a cluster of several zooms in to split it (at
    // the closest zoom, where it can't split any more, it selects its first event).
    onMarkerHover: (cluster, event) => {
      if (!cluster) { hover(null); tooltip.hide(); return; }
      if (cluster.items.length === 1) hover(dataset.eventTarget?.(cluster.items[0].id) ?? null);
      if (event.pointerType === 'mouse' && dataset.markerTooltip) tooltip.show(dataset.markerTooltip(cluster.items.map(m => m.id)), event);
    },
    onMarkerSelect: (cluster) => {
      if (cluster.items.length > 1 && map.canZoomIn()) map.zoomAround(cluster.x, cluster.y);
      else select(dataset.eventTarget?.(cluster.items[0].id) ?? null, { toUrl: true });
    },
  });

  $('zoomIn').onclick = () => map.zoomBy(1.6);
  $('zoomOut').onclick = () => map.zoomBy(1 / 1.6);
  $('zoomReset').onclick = () => map.resetZoom();

  // Feed items (in the feed, and the latest ones on the overview card) select their place;
  // "Show 90 days" in an empty list widens the window.
  const onListClick = (e) => {
    const widen = e.target.closest('[data-show-days]');
    if (widen) return dataset.showWindow(Number(widen.dataset.showDays));
    const btn = e.target.closest('button[data-key]');
    if (btn) select(dataset.feedTarget(btn.dataset.key), { zoom: true, toUrl: true });
  };
  const feed = $('recentList');
  feed.addEventListener('click', onListClick);
  feed.addEventListener('pointerover', (e) => {
    const btn = e.target.closest('button[data-key]');
    if (btn) hover(dataset.feedTarget(btn.dataset.key));
  });
  feed.addEventListener('pointerleave', () => hover(null));

  function applyPanel() {
    $('app').classList.toggle('panel-collapsed', !settings.get('panelOpen'));
    $('panelOpen').hidden = settings.get('panelOpen');
  }
  $('panelClose').onclick = () => { settings.set('panelOpen', false); applyPanel(); };
  $('panelOpen').onclick = () => { settings.set('panelOpen', true); applyPanel(); };
  applyPanel();

  const filters = $('filters');
  filters.open = settings.get('filtersOpen');
  filters.addEventListener('toggle', () => settings.set('filtersOpen', filters.open));

  // "How levels work": Escape (the dialog's own) and a click on the backdrop close it.
  const help = $('help');
  $('legend').addEventListener('click', (e) => { if (e.target.closest('[data-action="help"]')) help.showModal(); });
  help.addEventListener('click', (e) => { if (e.target === help) help.close(); });

  function hover(target) {
    hovered = target;
    map.setHovered(target?.placeId ?? null);
    renderDetails();
  }
  function select(target, { zoom = false, toUrl = false } = {}) {
    selected = target;
    map.setSelected(target?.placeId ?? null);
    map.setSelectedMarker(target?.eventId ?? null);
    renderDetails();
    if (zoom && target?.placeId) map.zoomTo(target.placeId);
    // The open country view follows the selected place, and closes with the selection.
    if (countryOpen) {
      if (target?.placeId && !target.eventId) renderCountry(target.placeId);
      else closeCountry({ toUrl: false });
    }
    if (toUrl) writeUrl();
  }

  // ---- the country view (risk modes)
  $('details').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="country"]');
    if (btn) return openCountry(btn.dataset.place, { toUrl: true });
    onListClick(e);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && countryOpen && !help.open) closeCountry({ toUrl: true }); });

  async function openCountry(placeId, { toUrl = false } = {}) {
    if (!places.has(placeId) || !(await countryViewer())) return;
    if (selected?.placeId !== placeId || selected?.eventId) select({ placeId });
    countryOpen = true;
    $('panel').classList.add('is-country');
    $('countryView').hidden = false;
    await renderCountry(placeId);
    if (toUrl) writeUrl();
  }
  async function renderCountry(placeId) {
    const viewer = await countryViewer();
    return viewer.renderCountryView($('countryView'), placeId, {
      back: () => closeCountry({ toUrl: true }),
      selectEvent: (id) => { closeCountry(); select(viewer.eventTarget(id), { zoom: true, toUrl: true }); },
    });
  }
  function closeCountry({ toUrl = false } = {}) {
    countryOpen = false;
    $('panel').classList.remove('is-country');
    $('countryView').hidden = true;
    $('countryView').innerHTML = '';
    renderDetails();
    if (toUrl) writeUrl();
  }

  /** Swap in another mode's dataset (loaded first, so the map never shows half a mode). */
  async function switchMode(id, { toUrl = false } = {}) {
    const next = pickMode(id);
    if (next === mode) return;
    const ds = await createDataset(next);
    mode = next;
    dataset = ds;
    settings.set('mode', mode.id);
    hovered = null;
    // A record belongs to its dataset, an event to the modes that show it: keep only the place.
    if (selected?.recordKey || selected?.eventId) selected = selected.placeId ? { placeId: selected.placeId } : null;
    map.setSelectedMarker(null);
    refresh();
    if (countryOpen) {
      if (selected?.placeId) await renderCountry(selected.placeId);
      else closeCountry();
    }
    if (toUrl) writeUrl();
  }

  // Written on user actions only, so a plain visit keeps a plain URL.
  function writeUrl() {
    const view = countryOpen ? 'country' : null;
    history.replaceState(null, '', `${location.pathname}${location.search}${formatHash({ mode: mode.id, place: selected?.placeId, view })}`);
  }
  window.addEventListener('hashchange', async () => {
    const want = parseHash(location.hash);
    if (want.mode) await switchMode(want.mode);
    const place = want.place && places.has(want.place) ? want.place : null;
    if (place !== (selected?.placeId ?? null)) select(place ? { placeId: place } : null, { zoom: !!place });
    if (want.view === 'country' && place && !countryOpen) await openCountry(place);
    else if (want.view !== 'country' && countryOpen) closeCountry();
  });
  function renderDetails() {
    const target = hovered ?? selected;
    $('details').innerHTML = dataset.details(target);
    const key = dataset.feedKeyFor(target);
    feed.querySelectorAll('button[data-key]').forEach(b => b.classList.toggle('is-active', b.dataset.key === key));
  }

  function refresh() {
    renderModes();
    $('map').setAttribute('aria-label', dataset.mapLabel());
    providerSwitch.render(dataset.providers(), dataset.provider(), dataset.providerSwitchLabel());
    $('asOf').textContent = dataset.header();
    $('asOf').classList.toggle('is-stale', dataset.stale());
    $('footer').innerHTML = dataset.footer();
    renderLegend();
    dataset.renderSettings($('datasetSettings'));
    dataset.renderFeed(feed);
    search.setEntries(dataset.searchEntries());
    map.setStyle((id) => dataset.style(id));
    map.setMarkers(dataset.markers?.() ?? []);
    renderDetails();
  }
  refresh();
  if (fromUrl.place && places.has(fromUrl.place)) {
    select({ placeId: fromUrl.place }, { zoom: true });
    if (fromUrl.view === 'country') await openCountry(fromUrl.place);
  }
}

/** Fill elements marked with data-i18n (text) and data-i18n-<attr> (attributes). */
function translateStaticText(i18n) {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = i18n.t(el.dataset.i18n);
  for (const attr of ['title', 'aria-label', 'placeholder']) {
    const data = `i18n${attr.replace(/(^|-)(\w)/g, (m, d, c) => c.toUpperCase())}`;   // data-i18n-aria-label -> i18nAriaLabel
    for (const el of document.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, i18n.t(el.dataset[data]));
  }
  document.title = i18n.t('app.title');
}

/**
 * Older saved settings:
 *  - `dataset` named the active dataset before there were modes; travel advisories is now the
 *    Travel mode
 *  - the first version kept travel-advisory options at the top level
 */
function migrateSettings(settings) {
  if (settings.get('dataset') !== undefined) {
    if (settings.get('dataset') === 'travel-advisories' && !settings.get('mode')) settings.set('mode', 'travel');
    settings.set('dataset', undefined);
  }
  if (settings.get('source') === undefined && settings.get('levels') === undefined) return;
  // A visitor of the first version only knew the travel map: keep them there.
  if (!settings.get('mode')) settings.set('mode', 'travel');
  const old = { provider: settings.get('source'), levels: settings.get('levels'), recentDays: settings.get('recentDays'), dimOthers: settings.get('dimOthers') };
  settings.set('travel-advisories', Object.fromEntries(Object.entries(old).filter(([, v]) => v !== undefined)));
  for (const key of ['source', 'levels', 'recentDays', 'dimOthers']) settings.set(key, undefined);
}
