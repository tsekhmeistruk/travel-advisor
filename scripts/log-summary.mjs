// Renders the fetch log (the store's fetch runs) as a Markdown table. Logic is in lib/log-summary.mjs.
//
//   In GitHub Actions: this run's results and every source's health, for the run's summary page
//     node scripts/log-summary.mjs >> "$GITHUB_STEP_SUMMARY"
//   Locally: every run in the last N days (default 7), newest first
//     node scripts/log-summary.mjs --days 30

import { relative } from 'node:path';
import { logFile, currentRun } from './lib/fetch-log.mjs';
import { readEntries, providerLabels, renderRunSummary, renderRecent, renderHealth } from './lib/log-summary.mjs';
import { createStore, ROOT } from './lib/store.mjs';

const store = createStore();
const labels = providerLabels(ROOT);

if (process.env.GITHUB_RUN_ID) {
  const entries = readEntries(Date.now() - 2 * 864e5, { store }).filter(e => e.run === currentRun());
  let logLink;
  if (entries.length) {
    const file = relative(ROOT, logFile(new Date(entries[0].time))).replaceAll('\\', '/');
    const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_REF_NAME: ref } = process.env;
    logLink = { file, url: `${server}/${repo}/blob/${ref}/${file}` };
  }
  console.log(renderRunSummary(entries, { labels, logLink }));
  // Published by the build step just before this one.
  const health = store.published('risk/health.json');
  if (health) console.log(`\n${renderHealth(health, { labels })}`);
} else {
  const i = process.argv.indexOf('--days');
  const days = i > -1 ? Number(process.argv[i + 1]) : 7;
  console.log(renderRecent(readEntries(Date.now() - days * 864e5, { store }), { labels, days }));
}
