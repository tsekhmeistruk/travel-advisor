// Registry of what the pipeline fetches.
//
// PROVIDERS: travel-advisory providers. To add one: create scripts/providers/<id>/index.mjs
// (default export { id, dataset, source, fetch }), add it here, add config/providers/<id>.json,
// list it in its dataset's config, and add its names to site/i18n/*.json.
//
// SOURCES: risk sources that report events (default export { id, kind: 'events', source,
// fetch }) or daily counts (kind: 'counts'), configured in config/sources/<id>.json.
//
// Every id also needs an entry in config/schedule.json and a step in the update workflow.

import us from './us/index.mjs';
import ca from './ca/index.mjs';
import nl from './nl/index.mjs';
import uk from './uk/index.mjs';
import de from './de/index.mjs';
import gdacs from './gdacs/index.mjs';
import who from './who/index.mjs';
import gdelt from './gdelt/index.mjs';

export const PROVIDERS = { us, ca, nl, uk, de };
export const SOURCES = { gdacs, who, gdelt };

export function getProvider(id) {
  const p = PROVIDERS[id] ?? SOURCES[id];
  if (!p) throw new Error(`Unknown provider "${id}". Known: ${[...Object.keys(PROVIDERS), ...Object.keys(SOURCES)].join(', ')}`);
  return p;
}
