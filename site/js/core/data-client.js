// Loads the site's data. Today it reads the static JSON published in site/data/; to move to a
// database, point `base` at an API that serves the same shapes (manifest, places, dataset
// files) and nothing else in the app needs to change. Responses are cached per path.
//
// GitHub Pages lets browsers cache files for a few minutes, and the data changes hourly. So
// the manifest is always revalidated, and a data file can be asked for with a version (its
// as-of time from the manifest), which becomes ?v=… and changes whenever the file does.

export function createDataClient({ base = 'data/', i18nBase = 'i18n/', fetchFn = globalThis.fetch?.bind(globalThis) } = {}) {
  const cache = new Map();

  function getJson(url, init) {
    if (!cache.has(url)) {
      cache.set(url, fetchFn(url, init).then(res => {
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        return res.json();
      }).catch(err => { cache.delete(url); throw err; }));
    }
    return cache.get(url);
  }

  return {
    manifest: () => getJson(`${base}manifest.json`, { cache: 'no-cache' }),
    /** A file named in the manifest (places, geo, dataset and risk files), optionally versioned. */
    file: (path, version) => getJson(`${base}${path}${version ? `?v=${encodeURIComponent(version)}` : ''}`),
    messages: (locale) => getJson(`${i18nBase}${locale}.json`),
  };
}
