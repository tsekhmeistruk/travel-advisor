// Datasets the app can show on the map. Today there is one (travel advisories); a future menu
// can switch between several (flights, other statistics) because they all implement the same
// interface and the map and panel only talk to that interface.
//
// A dataset module exports a factory: create(ctx) -> dataset, where
//   ctx = { i18n, settings, client, manifest (this dataset's manifest entry), places (Map id -> place), changed() }
// and the dataset provides:
//   id, load()                                  load the active provider's data
//   providers(), provider(), setProvider(id)    sources shown in the provider switch
//   mapLabel(), providerSwitchLabel(), header(), footer()
//   style(placeId)                              how the map draws a place (see map/world-map.js)
//   hasPlace(placeId)                           whether it has data for a place
//   details(target), tooltip(placeId), legend() HTML for the panel card, tooltip and legend
//   renderSettings(el), renderFeed(el)          its settings and its list of notable items
//   feedTarget(key), feedKeyFor(target)         map feed items to selection targets and back
//   searchEntries()                             what the search box can find
// A "target" is { placeId } for a place on the map, or { recordKey } for an item with no place.

import { createTravelAdvisories } from './travel-advisories/index.js';

export const DATASETS = {
  'travel-advisories': createTravelAdvisories,
};
