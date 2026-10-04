// The last check before a build is published (pure): the guards against a bad fetch that the
// deploy's data test gives the files (tests/data/data.test.mjs calls this too, so the two
// can't drift). The backend has no test gate between a fetch and the live site: a build with
// errors is not published, and the last good one stays.

/** The risk files every build must make: the manifest's key -> checked to be a published file. */
export const REQUIRED_RISK = ['current', 'changes', 'events', 'health', 'conflict', 'conflictEvents', 'wars'];
/** A provider that lost more than this share of its records since the last publish was fetched badly. */
export const MIN_RECORDS_SHARE = 0.8;

/**
 * @param files     what buildAll() made: { path: document }
 * @param previous  (path) => the document published last, or null (the first publish)
 * @returns a list of errors, empty when the build may be published
 */
export function validatePublish(files, previous = () => null) {
  const errors = [];
  const manifest = files['manifest.json'];
  if (!manifest) return ['manifest.json is missing'];
  const places = files[manifest.places];
  if (!Array.isArray(places) || !places.length) return [`${manifest.places ?? 'the places file'} is missing or empty`];
  const placeIds = new Set(places.map(p => p.id));
  const unknown = (ids) => ids.filter(id => !placeIds.has(id));

  for (const dataset of manifest.datasets ?? []) {
    const levels = new Set(dataset.scale.values);
    for (const provider of dataset.providers) {
      const data = files[provider.file];
      if (!data) { errors.push(`${provider.file} is named by the manifest and missing`); continue; }
      const before = previous(provider.file)?.records.length ?? 0;
      if (data.records.length < before * MIN_RECORDS_SHARE) {
        errors.push(`${provider.file}: ${data.records.length} records, ${before} were published (under ${MIN_RECORDS_SHARE * 100}%)`);
      }
      for (const r of data.records) {
        if (!levels.has(r.level)) errors.push(`${provider.file}: ${r.title} has level ${r.level}`);
        for (const id of unknown([...r.places, ...(r.covers ?? [])])) errors.push(`${provider.file}: ${r.title} is on the unknown place ${id}`);
      }
    }
  }

  const risk = manifest.risk ?? {};
  for (const name of REQUIRED_RISK) {
    if (!risk[name] || !files[risk[name]]) errors.push(`risk.${name} is not a published file`);
  }
  const current = files[risk.current];
  if (current) {
    const levels = new Set(current.scale.values);
    for (const [id, signals] of Object.entries(current.places)) {
      if (!placeIds.has(id)) errors.push(`${risk.current}: unknown place ${id}`);
      for (const [category, s] of Object.entries(signals)) {
        if (!levels.has(s.level)) errors.push(`${risk.current}: ${id}/${category} has level ${s.level}`);
      }
    }
    for (const e of files[risk.events]?.events ?? []) {
      if (e.level != null && !levels.has(e.level)) errors.push(`${risk.events}: ${e.id} has level ${e.level}`);
      for (const id of unknown(e.placeIds)) errors.push(`${risk.events}: ${e.id} is on the unknown place ${id}`);
    }
    for (const id of placeIds) {
      if (!files[`${risk.places}${id}.json`]) errors.push(`${risk.places}${id}.json is missing`);
    }
  }
  return errors;
}
