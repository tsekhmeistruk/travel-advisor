// The map's modes. Each mode is a dataset module: the map and panel only talk to the interface
// below, so a mode can show travel advisories, a risk category, or anything else later.
// main.js offers the modes whose data the manifest lists, and switches between them in place.
//
// A dataset module exports a factory: create(ctx) -> dataset, where
//   ctx = { i18n, settings, client, manifest (this mode's manifest entry), places (Map id -> place), changed() }
// and the dataset provides:
//   id, load()                                  load its data
//   providers(), provider(), setProvider(id)    sources shown in the provider switch (none: hidden)
//   mapLabel(), providerSwitchLabel(), header(), footer()
//   style(placeId)                              how the map draws a place (see map/world-map.js)
//   hasPlace(placeId)                           whether it has data for a place
//   details(target), tooltip(placeId), legend() HTML for the panel card, tooltip and legend
//   renderSettings(el), renderFeed(el)          its settings and its list of notable items
//   feedTarget(key), feedKeyFor(target)         map feed items to selection targets and back
//   searchEntries()                             what the search box can find
// and optionally, for point markers (events):
//   markers()                                   [{ id, lon, lat, kind, level }] for the map
//   eventTarget(id), markerTooltip(ids)         a marker's selection target, and its tooltip HTML
// A "target" is { placeId } for a place on the map, { recordKey } for an item with no place, or
// { eventId, placeId? } for an event (the card shows the event; its place is highlighted).

import { createTravelAdvisories } from './travel-advisories/index.js';
import { createRiskMode } from './risk/index.js';

export const DATASETS = {
  'travel-advisories': createTravelAdvisories,
};

const risk = (options) => (ctx) => createRiskMode({ ...ctx, ...options });

/**
 * The modes, in the order of the mode switch. `entry(manifest)` is the mode's manifest entry,
 * or undefined when its data isn't published (the mode is then not offered).
 */
export const MODES = [
  { id: 'travel', create: createTravelAdvisories, entry: (m) => m.datasets.find(d => d.id === 'travel-advisories') },
  { id: 'highest', create: risk({ mode: 'highest', view: 'highest' }), entry: (m) => m.risk },
  { id: 'disaster', create: risk({ mode: 'disaster', view: 'category', category: 'disaster' }), entry: (m) => m.risk },
  { id: 'wildfire', create: risk({ mode: 'wildfire', view: 'category', category: 'wildfire' }), entry: (m) => m.risk },
  { id: 'changes', create: risk({ mode: 'changes', view: 'changes' }), entry: (m) => m.risk },
];
export const DEFAULT_MODE = 'highest';
