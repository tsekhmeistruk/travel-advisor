// Registry of data providers. To add one: create scripts/providers/<id>/index.mjs (default
// export { id, dataset, source, minorChange, fetch }), add it here, add config/providers/<id>.json,
// list it in its dataset's config, and add its names to site/i18n/*.json.

import us from './us/index.mjs';
import ca from './ca/index.mjs';
import nl from './nl/index.mjs';

export const PROVIDERS = { us, ca, nl };

export function getProvider(id) {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown provider "${id}". Known: ${Object.keys(PROVIDERS).join(', ')}`);
  return p;
}
