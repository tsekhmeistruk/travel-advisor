// Loads the site's data. Today it reads the static JSON published in site/data/; to move to a
// database, point `base` at an API that serves the same shapes (manifest, places, dataset
// files) and nothing else in the app needs to change. Responses are cached per path.

export function createDataClient({ base = 'data/', i18nBase = 'i18n/', fetchFn = globalThis.fetch?.bind(globalThis) } = {}) {
  const cache = new Map();

  function getJson(url) {
    if (!cache.has(url)) {
      cache.set(url, fetchFn(url).then(res => {
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        return res.json();
      }).catch(err => { cache.delete(url); throw err; }));
    }
    return cache.get(url);
  }

  return {
    manifest: () => getJson(`${base}manifest.json`),
    /** A file named in the manifest (places, geo, dataset provider files). */
    file: (path) => getJson(`${base}${path}`),
    messages: (locale) => getJson(`${i18nBase}${locale}.json`),
  };
}
