// Renders the fetch log (logs/fetch/) as a Markdown table. Logic is in lib/log-summary.mjs.
//
//   In GitHub Actions: this run's results, for the run's summary page
//     node scripts/log-summary.mjs >> "$GITHUB_STEP_SUMMARY"
//   Locally: every run in the last N days (default 7), newest first
//     node scripts/log-summary.mjs --days 30

import { relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logFile, currentRun } from './lib/fetch-log.mjs';
import { readEntries, providerLabels, renderRunSummary, renderRecent } from './lib/log-summary.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const labels = providerLabels(root);

if (process.env.GITHUB_RUN_ID) {
  const entries = readEntries(Date.now() - 2 * 864e5).filter(e => e.run === currentRun());
  let logLink;
  if (entries.length) {
    const file = relative(root, logFile(new Date(entries[0].time))).replaceAll('\\', '/');
    const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_REF_NAME: ref } = process.env;
    logLink = { file, url: `${server}/${repo}/blob/${ref}/${file}` };
  }
  console.log(renderRunSummary(entries, { labels, logLink }));
} else {
  const i = process.argv.indexOf('--days');
  const days = i > -1 ? Number(process.argv[i + 1]) : 7;
  console.log(renderRecent(readEntries(Date.now() - days * 864e5), { labels, days }));
}
