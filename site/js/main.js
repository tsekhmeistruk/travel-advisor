// App entry point: loads data and language, creates the active mode's dataset and the map, and
// wires the panel. The map and panel are generic; everything mode-specific comes from the
// dataset module (see datasets/registry.js). Switching modes swaps the dataset in place: the
// map, its zoom and the selected place stay.
//
// Interaction model: a "target" is { placeId }, { recordKey }, { eventId, placeId? } or, in Wars,
// { warKey }. Hovering only informs: the map highlights the target and the tooltip says the
// essentials; the panel never changes. Clicking selects: the panel shows the selected target
// until × (data-action="close"), Escape or a click on the ocean. A war also colours its sides on
// the map (dataset.focus), hovered or selected.
// The mode and the selected place or war are also kept in the URL (#mode=…&place=…), for links.

import { $, esc } from './core/dom.js';
import { createI18n, chooseLocale } from './core/i18n.js';
import { createSettings } from './core/settings.js';
import { createDataClient } from './core/data-client.js';
import { parseHash, formatHash, startState } from './core/url-state.js';
import { WorldMap } from './map/world-map.js';
import { createMascot } from './map/mascot.js';
import { CHARACTERS, DEFAULT_CHARACTER } from './map/characters.js';
import { MODES, DEFAULT_MODE, RENAMED } from './datasets/registry.js';
import { createSearch } from './ui/search.js';
import { createProviderSwitch, createModeSwitch, createThemeToggle, createLanguagePicker, createTooltip } from './ui/controls.js';

const STORAGE_KEY = 'travel-risk-map:settings';

main().catch((err) => {
  console.error(err);
  const box = $('loadError');
  if (box) box.hidden = false;
}).finally(() => $('app')?.removeAttribute('aria-busy'));

async function main() {
  const client = createDataClient();
  const settings = createSettings(STORAGE_KEY, { theme: 'auto', panelOpen: true, mode: null, locale: null, mascot: DEFAULT_CHARACTER });
  migrateSettings(settings);

  // ---- language
  const manifest = await client.manifest();
  const locale = chooseLocale(manifest.locales, {
    saved: settings.get('locale'), browser: navigator.languages ?? [navigator.language], fallback: manifest.defaultLocale,
  });
  const [messages, fallback, placeList, topo, admin1] = await Promise.all([
    client.messages(locale),
    locale === manifest.defaultLocale ? null : client.messages(manifest.defaultLocale),
    client.file(manifest.places),
    client.file(manifest.geo),
    // The borders between states and provinces (the U.S., Canada): the map does without them.
    manifest.admin1 ? client.file(manifest.admin1).catch(() => null) : null,
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
  const findMode = (id) => modes.find(m => m.id === (RENAMED[id] ?? id));
  const pickMode = (id) => findMode(id) ?? findMode(settings.get('mode')) ?? findMode(DEFAULT_MODE) ?? modes[0];
  // A selected place's blocks and the countries list come from a risk mode; a mode without one
  // (Travel) borrows one.
  const viewerMode = modes.find(m => m.id === 'highest');
  let borrowedViewer = null;
  const countryViewer = async () => (dataset.placeBlocks ? dataset : viewerMode ? (borrowedViewer ??= await createDataset(viewerMode)) : null);
  const createDataset = async (m) => {
    const ds = m.create({ i18n, settings, client, manifest: m.entry(manifest), places, changed: () => refresh(), countryView: !!viewerMode });
    await ds.load();
    return ds;
  };
  // A refresh starts at home (no selection); the address then says so too. A link still opens its place.
  const fromUrl = startState(parseHash(location.hash), performance.getEntriesByType('navigation')[0]?.type);
  if (formatHash(fromUrl) !== formatHash(parseHash(location.hash))) history.replaceState(null, '', `${location.pathname}${location.search}${formatHash(fromUrl)}`);
  let mode = pickMode(fromUrl.mode);
  let dataset = await createDataset(mode);

  // ---- panel and map
  let hovered = null;
  let selected = null;
  let panelView = null;   // 'list': the countries list in place of the blocks
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
    subdivisions: Object.values(admin1?.countries ?? {}).flat(),
    places: placeList,
    bottomInset: () => $('legend').offsetHeight,
    // The mode switch's row (the provider switch below it may overlap the map's top edge).
    topInset: () => $('modeSwitch').offsetHeight,
    labelFor: (id) => (places.has(id) ? i18n.placeName(places.get(id)) : null),
    // Labels stay clear of everything on top of the map: both switches, and the legend.
    labelInsets: () => ({ top: $('mapTop').getBoundingClientRect().bottom - mapArea.getBoundingClientRect().top + 4, bottom: $('legend').offsetHeight + 20 }),
    onHover: (region, event) => {
      hover(region ? { placeId: region.key } : null);
      if (region && event.pointerType === 'mouse') tooltip.show(dataset.tooltip(region.key), event);
      else tooltip.hide();
    },
    onMove: (event) => { if (event.pointerType === 'mouse') tooltip.move(event); },
    // A clicked country: the panel opens if it was hidden, and the map zooms in only as far as
    // it takes to show the country's name (not at all if it shows already).
    onSelect: (region) => {
      if (region && selected?.placeId !== region.key) return choosePlace(region.key);
      select(null, { toUrl: true });
      showSheet();
    },
    // A marker previews and selects its event; a cluster of several zooms in to split it (at
    // the closest zoom, where it can't split any more, it selects its first event).
    onMarkerHover: (cluster, event) => {
      if (!cluster) { hover(null); tooltip.hide(); return; }
      if (cluster.items.length === 1) hover(dataset.eventTarget?.(cluster.items[0].id) ?? null);
      if (event.pointerType === 'mouse' && dataset.markerTooltip) tooltip.show(dataset.markerTooltip(cluster.items.map(m => m.id)), event);
    },
    onMarkerSelect: (cluster) => {
      if (cluster.items.length > 1 && map.canZoomIn()) map.zoomAround(cluster.x, cluster.y);
      else { select(dataset.eventTarget?.(cluster.items[0].id) ?? null, { toUrl: true }); showSheet(); }
    },
    // A dot (an event of the month, in Wars) explains itself; a click picks its war.
    onPointHover: (point, event) => {
      if (point && event.pointerType === 'mouse' && dataset.pointTooltip) tooltip.show(dataset.pointTooltip(point.id), event);
      else tooltip.hide();
    },
    onPointSelect: (point) => { select(dataset.pointTarget?.(point.id) ?? null, { zoom: true, toUrl: true }); showSheet(); },
  });

  $('zoomIn').onclick = () => map.zoomBy(1.6);
  $('zoomOut').onclick = () => map.zoomBy(1 / 1.6);
  $('zoomReset').onclick = () => map.resetZoom();
  // The capybara in Canada looks east, towards the selection, and now and then at the visitor.
  // Put down on a country, it chooses that country, as a click there would.
  const mascot = createMascot(map, { character: settings.get('mascot'), onPlace: (placeId) => choosePlace(placeId) });
  // The switch under the zoom buttons: who stands there (remembered).
  const renderMascots = () => {
    $('mascotSwitch').innerHTML = CHARACTERS.map(c => {
      const name = esc(i18n.t(`mascot.${c.id}`));
      return `<button class="icon-btn" data-mascot="${c.id}" aria-pressed="${c.id === mascot.character}" title="${name}" aria-label="${name}"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${c.icon}</svg></button>`;
    }).join('');
  };
  renderMascots();
  $('mascotSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mascot]');
    if (!btn) return;
    mascot.setCharacter(btn.dataset.mascot);
    settings.set('mascot', mascot.character);
    renderMascots();
  });
  const look = () => mascot.lookAt({
    placeIds: selected?.warKey ? dataset.warPlaces?.(selected.warKey) ?? [] : selected?.placeId ? [selected.placeId] : [],
    markerId: selected?.eventId ?? null,
  });

  // Feed items (in the feed, and the latest ones on the overview card) select their place.
  const onListClick = (e) => {
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

  // One button on the map's edge shows and hides the panel; its arrow points where the panel will go.
  function applyPanel() {
    const open = settings.get('panelOpen');
    $('app').classList.toggle('panel-collapsed', !open);
    const label = i18n.t(open ? 'panel.hide' : 'panel.show');
    const btn = $('panelToggle');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-expanded', String(open));
  }
  // The footer's "How it works" opens the help, like the legend's button.
  $('footer').addEventListener('click', (e) => { if (e.target.closest('[data-action="help"]')) $('help').showModal(); });
  $('panelToggle').onclick = () => { settings.set('panelOpen', !settings.get('panelOpen')); applyPanel(); };
  /** A country chosen on the map (a click on it, or the mascot put down on it): selected, in a panel that is open, its name on the map. */
  function choosePlace(placeId) {
    openPanel();
    select({ placeId }, { toUrl: true });
    map.showLabel(placeId);
    showSheet();
  }
  /** Show the panel if it is hidden; the map takes its new size at once, so a zoom started next isn't undone by it. */
  function openPanel() {
    if (settings.get('panelOpen')) return;
    settings.set('panelOpen', true);
    applyPanel();
    map.layout();
  }
  applyPanel();


  // "How levels work": Escape (the dialog's own) and a click on the backdrop close it.
  const help = $('help');
  // The legend: its levels show or hide their places; ⓘ opens the help.
  $('legend').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="help"]')) return help.showModal();
    const level = e.target.closest('[data-level]');
    if (level) dataset.toggleLevel?.(Number(level.dataset.level));
  });
  help.addEventListener('click', (e) => { if (e.target === help) help.close(); });

  function hover(target) {
    hovered = target;
    map.setHovered(target?.placeId ?? null);
    applyFocus();
    markFeed();
  }
  // The war the map shows: the hovered one, else the selected one. A change repaints the map.
  const focusTarget = () => (hovered?.warKey ? hovered : selected?.warKey ? selected : null);
  function applyFocus() {
    if (!dataset.focus?.(focusTarget())) return;
    map.repaint();
    map.setPoints(dataset.points?.() ?? []);
  }
  // ---- phones: a tap on the map shows what was tapped in a sheet over the map, since the card
  // is below it. Details scrolls to the card (or the open panel view); × or the ocean closes it.
  const phone = matchMedia('(max-width: 760px)');
  const sheet = $('sheet');
  function showSheet() {
    const t = selected;
    if (!phone.matches || !(t?.placeId || t?.eventId || t?.warKey)) return hideSheet();
    $('sheetBody').innerHTML = t.warKey && dataset.warTooltip ? dataset.warTooltip(t.warKey)
      : t.eventId && dataset.markerTooltip ? dataset.markerTooltip([t.eventId]) : dataset.tooltip(t.placeId);
    sheet.hidden = false;
  }
  function hideSheet() { sheet.hidden = true; }
  $('sheetClose').onclick = hideSheet;
  $('sheetDetails').onclick = () => {
    hideSheet();
    $(panelView === 'list' ? 'listView' : 'details').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /** follow: an open countries list closes for the selection (off when the list selects the place itself). */
  function select(target, { zoom = false, toUrl = false, follow = true } = {}) {
    hideSheet();   // a tap on the map shows it again (see showSheet)
    selected = target;
    map.setSelected(target?.placeId ?? null);
    map.setSelectedMarker(target?.eventId ?? null);
    applyFocus();
    look();
    renderDetails();
    // An event zooms to its marker when the mode shows one, otherwise to its place; a war to where it is fought.
    if (zoom && target?.warKey) map.zoomToPlaces(dataset.warPlaces?.(target.warKey) ?? []);
    else if (zoom && !(target?.eventId && map.zoomToMarker(target.eventId)) && target?.placeId) map.zoomTo(target.placeId);
    // A selection shows its blocks: the countries list makes way.
    if (follow && panelView === 'list' && target) closeView();
    if (toUrl) writeUrl();
  }

  // ---- the panel's blocks and the countries list (from a risk mode, borrowed in Travel)
  $('details').addEventListener('click', async (e) => {
    if (e.target.closest('[data-action="close"]')) return select(null, { toUrl: true });
    if (e.target.closest('[data-action="share"]') && selected?.placeId) return shareCountry(selected.placeId);
    const ev = e.target.closest('[data-event]');
    if (ev) {
      const target = dataset.eventTarget?.(ev.dataset.event) ?? (await countryViewer())?.eventTarget?.(ev.dataset.event);
      return target && select(target, { zoom: true, toUrl: true });
    }
    const war = e.target.closest('[data-war]');
    if (war) return select({ warKey: war.dataset.war }, { zoom: true, toUrl: true });
    const place = e.target.closest('button[data-place]');
    if (place) return select({ placeId: place.dataset.place }, { zoom: true, toUrl: true });
    onListClick(e);
  });
  $('listOpen').onclick = () => openList({ toUrl: true });
  // Escape closes the countries list, else clears the selection.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || help.open) return;
    if (panelView) closeView({ toUrl: true });
    else if (selected) select(null, { toUrl: true });
  });
  // "/" goes to the search, unless the visitor is typing somewhere.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || help.open) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    $('search').focus();
  });

  /** Show the countries list in place of the blocks, or nothing. */
  function showView(kind) {
    panelView = kind;
    $('panel').classList.toggle('is-country', !!kind);
    $('listView').hidden = kind !== 'list';
    if (!kind) $('listView').innerHTML = '';
  }
  /** A country chosen in the list: the list closes, the country is selected and the panel shows its blocks. */
  function openCountry(placeId, { toUrl = false, zoom = false } = {}) {
    if (!places.has(placeId)) return;
    if (panelView) showView(null);
    select({ placeId }, { zoom, toUrl, follow: false });
  }
  async function openList({ toUrl = false } = {}) {
    const viewer = await countryViewer();
    if (!viewer) return;
    const fresh = !$('listView').childElementCount;
    showView('list');
    if (fresh) {
      viewer.renderCountryList($('listView'), {
        open: (id) => openCountry(id, { toUrl: true, zoom: true }),
        back: () => closeView({ toUrl: true }),
        hover: (id) => hover(id ? { placeId: id } : null),
      });
    }
    if (toUrl) writeUrl();
  }
  // Share a selected country: the share sheet on a touch screen, else the link is copied.
  const touch = matchMedia('(pointer: coarse)');
  async function shareCountry(placeId) {
    const url = `${location.origin}${location.pathname}${formatHash({ mode: mode.id, place: placeId })}`;
    if (touch.matches && navigator.share) {
      try { await navigator.share({ title: `${i18n.placeName(places.get(placeId))} · ${i18n.t('app.title')}`, url }); } catch { /* cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(i18n.t('share.copied'));
    } catch {
      showToast(i18n.t('share.failed'));
    }
  }
  let toastTimer = null;
  function showToast(text) {
    const toast = $('toast');
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2500);
  }

  /** Close the countries list: the blocks show again. */
  function closeView({ toUrl = false } = {}) {
    hovered = null;
    showView(null);
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
    // A record belongs to its dataset, an event to the modes that show it: keep only the place. A war is Wars' own.
    if (selected?.recordKey || selected?.eventId) selected = selected.placeId ? { placeId: selected.placeId } : null;
    if (selected?.warKey) selected = null;
    map.setSelectedMarker(null);
    refresh();
    // The list shows this mode's levels: redraw it.
    $('listView').innerHTML = '';
    if (panelView === 'list') await openList();
    if (toUrl) writeUrl();
  }

  // Written on user actions only, so a plain visit keeps a plain URL.
  function writeUrl() {
    history.replaceState(null, '', `${location.pathname}${location.search}${formatHash({ mode: mode.id, place: selected?.placeId, war: selected?.warKey, view: panelView === 'list' ? 'list' : null })}`);
  }
  window.addEventListener('hashchange', async () => {
    const want = parseHash(location.hash);
    if (want.mode) await switchMode(want.mode);
    const place = want.place && places.has(want.place) ? want.place : null;
    const war = !place && want.war && dataset.hasWar?.(want.war) ? want.war : null;
    if (war) {
      if (war !== selected?.warKey) select({ warKey: war }, { zoom: true, follow: false });
    } else if (place !== (selected?.placeId ?? null)) select(place ? { placeId: place } : null, { zoom: !!place, follow: false });
    // An old link to a country view (view=country) just selects the country.
    if (want.view === 'list') {
      if (panelView !== 'list') await openList();
    } else if (panelView) {
      closeView();
    }
  });
  // The panel shows the selection only (hovering informs through the tooltip and the map): the
  // overview's blocks, or the selection's block (with Share for a country, and × to clear it) and,
  // for a country, its other blocks from its place file (placeBlocks, loaded after).
  let blocksAsked = 0;
  function renderDetails() {
    const target = selected;
    const place = target?.placeId && !target.eventId ? target.placeId : null;
    const tools = target ? `<div class="card-tools">${place ? `<button class="icon-btn ghost" data-action="share" title="${i18n.t('risk.country.share')}" aria-label="${i18n.t('risk.country.share')}"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ''}<button class="card-close icon-btn ghost" data-action="close" title="${i18n.t('panel.clear')}" aria-label="${i18n.t('panel.clear')}">×</button></div>` : '';
    $('details').innerHTML = target ? `<section class="card block selected">${tools}${dataset.details(target)}</section>` : dataset.details(null);
    markFeed();
    const asked = ++blocksAsked;
    if (place) {
      countryViewer().then(viewer => viewer?.placeBlocks(place, { mode: mode.id })).then(html => {
        if (asked === blocksAsked && html) $('details').insertAdjacentHTML('beforeend', html);
      });
    }
  }
  /** The feed's row of the hovered or selected target. */
  function markFeed() {
    const key = dataset.feedKeyFor(hovered ?? selected);
    feed.querySelectorAll('button[data-key]').forEach(b => b.classList.toggle('is-active', b.dataset.key === key));
  }

  function refresh() {
    renderModes();
    $('map').setAttribute('aria-label', dataset.mapLabel());
    providerSwitch.render(dataset.providers(), dataset.provider(), dataset.providerSwitchLabel());
    $('asOf').textContent = dataset.header();
    $('asOf').title = $('asOf').textContent;
    $('asOf').classList.toggle('is-stale', dataset.stale());
    $('footer').innerHTML = dataset.footer();
    renderLegend();
    dataset.renderFeed(feed);
    search.setEntries(dataset.searchEntries());
    const placeholder = dataset.searchPlaceholder?.() ?? i18n.t('search.placeholder');
    $('search').placeholder = placeholder;
    $('search').setAttribute('aria-label', placeholder);
    dataset.focus?.(focusTarget());
    map.setStyle((id) => dataset.style(id));
    map.setMarkers(dataset.markers?.() ?? []);
    map.setPoints(dataset.points?.() ?? []);
    look();
    renderDetails();
    if (!sheet.hidden) showSheet();   // this mode's view of the selection
  }
  refresh();
  if (fromUrl.place && places.has(fromUrl.place)) select({ placeId: fromUrl.place }, { zoom: true });
  else if (fromUrl.war && dataset.hasWar?.(fromUrl.war)) select({ warKey: fromUrl.war }, { zoom: true });
  if (fromUrl.view === 'list') await openList();
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
 *  - the Wildfires and Changes modes were merged into Disasters and Wars (RENAMED)
 */
function migrateSettings(settings) {
  if (RENAMED[settings.get('mode')]) settings.set('mode', RENAMED[settings.get('mode')]);
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
