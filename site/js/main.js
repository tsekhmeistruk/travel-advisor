// App entry point: loads data and language, creates the active dataset and the map, and wires
// the panel. The map and panel are generic; everything dataset-specific comes from the
// dataset module (see datasets/registry.js).
//
// Interaction model: a "target" is { placeId } or { recordKey }. Hovering sets a temporary
// target, clicking sets the selected one; the details card shows hovered ?? selected.

import { $ } from './core/dom.js';
import { createI18n, chooseLocale } from './core/i18n.js';
import { createSettings } from './core/settings.js';
import { createDataClient } from './core/data-client.js';
import { WorldMap } from './map/world-map.js';
import { DATASETS } from './datasets/registry.js';
import { createSearch } from './ui/search.js';
import { createProviderSwitch, createThemeToggle, createLanguagePicker, createTooltip } from './ui/controls.js';

const STORAGE_KEY = 'travel-risk-map:settings';

main().catch((err) => {
  console.error(err);
  const box = $('loadError');
  if (box) box.hidden = false;
});

async function main() {
  const client = createDataClient();
  const settings = createSettings(STORAGE_KEY, { theme: 'auto', panelOpen: true, dataset: null, locale: null });
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

  // ---- dataset
  const places = new Map(placeList.map(p => [p.id, p]));
  const entry = manifest.datasets.find(d => d.id === settings.get('dataset')) ?? manifest.datasets[0];
  const dataset = DATASETS[entry.id]({ i18n, settings, client, manifest: entry, places, changed: () => refresh() });
  await dataset.load();

  // ---- panel and map
  let hovered = null;
  let selected = null;
  const mapArea = $('mapArea');
  const tooltip = createTooltip($('tooltip'), mapArea);
  const search = createSearch({
    input: $('search'), results: $('searchResults'),
    noMatchesText: () => i18n.t('search.noMatches'),
    onChoose: (target) => select(target, { zoom: true }),
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

  $('legend').innerHTML = dataset.legend();   // measured by the map's layout
  const map = new WorldMap({
    svg: $('map'),
    container: mapArea,
    topo,
    places: placeList,
    bottomInset: () => $('legend').offsetHeight,
    onHover: (region, event) => {
      hover(region ? { placeId: region.key } : null);
      if (region && event.pointerType === 'mouse') tooltip.show(dataset.tooltip(region.key), event);
      else tooltip.hide();
    },
    onMove: (event) => { if (event.pointerType === 'mouse') tooltip.move(event); },
    onSelect: (region) => select(region && selected?.placeId !== region.key ? { placeId: region.key } : null),
  });

  $('zoomIn').onclick = () => map.zoomBy(1.6);
  $('zoomOut').onclick = () => map.zoomBy(1 / 1.6);
  $('zoomReset').onclick = () => map.resetZoom();

  const feed = $('recentList');
  feed.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-key]');
    if (btn) select(dataset.feedTarget(btn.dataset.key), { zoom: true });
  });
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

  function hover(target) {
    hovered = target;
    map.setHovered(target?.placeId ?? null);
    renderDetails();
  }
  function select(target, { zoom = false } = {}) {
    selected = target;
    map.setSelected(target?.placeId ?? null);
    renderDetails();
    if (zoom && target?.placeId) map.zoomTo(target.placeId);
  }
  function renderDetails() {
    const target = hovered ?? selected;
    $('details').innerHTML = dataset.details(target);
    const key = dataset.feedKeyFor(target);
    feed.querySelectorAll('button[data-key]').forEach(b => b.classList.toggle('is-active', b.dataset.key === key));
  }

  function refresh() {
    $('map').setAttribute('aria-label', dataset.mapLabel());
    providerSwitch.render(dataset.providers(), dataset.provider(), dataset.providerSwitchLabel());
    $('asOf').textContent = dataset.header();
    $('footer').innerHTML = dataset.footer();
    $('legend').innerHTML = dataset.legend();
    dataset.renderSettings($('datasetSettings'));
    dataset.renderFeed(feed);
    search.setEntries(dataset.searchEntries());
    map.setStyle((id) => dataset.style(id));
    renderDetails();
  }
  refresh();
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

/** Settings saved by the previous version kept travel-advisory options at the top level. */
function migrateSettings(settings) {
  if (settings.get('source') === undefined && settings.get('levels') === undefined) return;
  const old = { provider: settings.get('source'), levels: settings.get('levels'), recentDays: settings.get('recentDays'), dimOthers: settings.get('dimOthers') };
  settings.set('travel-advisories', Object.fromEntries(Object.entries(old).filter(([, v]) => v !== undefined)));
  for (const key of ['source', 'levels', 'recentDays', 'dimOthers']) settings.set(key, undefined);
}
