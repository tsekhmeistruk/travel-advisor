// Renders the fetch log (logs/fetch/) as a Markdown table.
//
//   In GitHub Actions: this run's results, for the run's summary page
//     node scripts/log-summary.mjs >> "$GITHUB_STEP_SUMMARY"
//   Locally: every run in the last N days (default 7), newest first
//     node scripts/log-summary.mjs --days 30

import { readFileSync, existsSync } from 'node:fs';
import { relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logFile, currentRun } from './lib/fetch-log.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_LABELS = providerLabels();
const CALL_LABELS = { api: 'API', rss: 'RSS', table: 'Table', pages: 'Pages' };

const inActions = !!process.env.GITHUB_RUN_ID;
const daysArg = process.argv.indexOf('--days');
const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) : 7;

const since = inActions ? Date.now() - 2 * 864e5 : Date.now() - days * 864e5;
const entries = readEntries(since)
  .filter(e => !inActions || e.run === currentRun())
  .sort((a, b) => b.time.localeCompare(a.time));

const lines = [];
if (inActions) {
  lines.push('### Fetch results', '');
  if (!entries.length) {
    lines.push('No fetch ran in this run.');
  } else {
    lines.push('| Source | Result | Requests | Data | Time |', '|---|---|---|---|---|');
    for (const e of entries) lines.push(row(e, false));
    const file = relative(root, logFile(new Date(entries[0].time))).replaceAll('\\', '/');
    const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_REF_NAME: ref } = process.env;
    lines.push('', `Full log: [\`${file}\`](${server}/${repo}/blob/${ref}/${file})`);
  }
} else {
  lines.push(`Fetch runs in the last ${days} days`, '');
  if (!entries.length) {
    lines.push('No runs logged.');
  } else {
    lines.push('| When (UTC) | Trigger | Source | Result | Requests | Data | Time |', '|---|---|---|---|---|---|---|');
    for (const e of entries) lines.push(row(e, true));
  }
}
console.log(lines.join('\n'));

// ---- helpers

// "🇺🇸 United States" for each provider: flag emoji from its config, name from site/i18n/en.json.
function providerLabels() {
  const labels = {};
  try {
    const en = JSON.parse(readFileSync(join(root, 'site', 'i18n', 'en.json'), 'utf8'));
    for (const dataset of Object.values(en.datasets ?? {})) {
      for (const [id, p] of Object.entries(dataset.providers ?? {})) {
        const cfg = join(root, 'config', 'providers', `${id}.json`);
        const flag = existsSync(cfg) ? JSON.parse(readFileSync(cfg, 'utf8')).flag : null;
        labels[id] = `${flag ? flagEmoji(flag) + ' ' : ''}${p.short ?? p.name ?? id}`;
      }
    }
  } catch { /* fall back to raw ids */ }
  return labels;
}
function flagEmoji(code) {
  return String.fromCodePoint(...code.toUpperCase().split('').map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function readEntries(sinceMs) {
  const out = [];
  // One file per month: read each month from `since` to now.
  for (let d = new Date(sinceMs); ; d.setUTCMonth(d.getUTCMonth() + 1, 1)) {
    const file = logFile(d);
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (Date.parse(e.time) >= sinceMs) out.push(e);
        } catch { /* skip a damaged line rather than fail the summary */ }
      }
    }
    if (d.getUTCFullYear() > new Date().getUTCFullYear()
      || (d.getUTCFullYear() === new Date().getUTCFullYear() && d.getUTCMonth() >= new Date().getUTCMonth())) break;
  }
  return out;
}

function row(e, withWhen) {
  const cells = [
    SOURCE_LABELS[e.source] ?? e.source,
    result(e),
    Object.entries(e.calls).map(([name, c]) => `${CALL_LABELS[name] ?? name}: ${callSummary(c)}`).join('<br>') || '–',
    data(e),
    duration(e.durationMs),
  ];
  if (withWhen) cells.unshift(e.time.slice(0, 16).replace('T', ' '), e.trigger);
  return `| ${cells.map(cell).join(' | ')} |`;
}

function result(e) {
  if (e.result !== 'ok') return '❌ Failed';
  const retried = Object.values(e.calls).some(c => (c.attempts?.length ?? 0) > 1);
  if (retried) return '⚠️ OK after retry';
  if (e.warnings?.length) return '⚠️ OK with warnings';
  return '✅ OK';
}

// Detailed calls list each attempt ("429 → 200"); aggregated ones show counts ("6× 200").
function callSummary(c) {
  if (c.attempts) {
    return c.attempts.map(a => a.error ? `✗ ${a.error}` : a.challenge ? `${a.status} challenge` : String(a.status)).join(' → ');
  }
  if (!c.requests) return 'none';
  const parts = Object.entries(c.statuses).map(([s, n]) => `${n}× ${s}`);
  if (c.errors) parts.push(`${c.errors}× error`);
  if (c.challenges) parts.push(`${c.challenges}× challenge`);
  return parts.join(', ');
}

function data(e) {
  const s = e.stats ?? {};
  const parts = [];
  if (e.source === 'us' && s.advisories != null) {
    parts.push(`${s.advisories} advisories`);
    if (s.keptFromPrevious?.length) parts.push(`${s.keptFromPrevious.length} kept from previous (${s.keptFromPrevious.join(', ')})`);
    if (s.changeNotes != null) parts.push(`${s.changeNotes} change notes`);
  }
  if (e.source === 'ca' && s.destinations != null) {
    parts.push(`${s.destinations} destinations`);
    const changed = Array.isArray(s.changed)
      ? (s.changed.length === 0 ? 'none changed' : s.changed.length <= 6 ? `changed: ${s.changed.join(', ')}` : `${s.changed.length} changed`)
      : `${s.changed} read`;
    parts.push(changed);
    if (s.pagesFailed) parts.push(`${s.pagesFailed} pages failed`);
  }
  if (e.error) parts.push(`Error: ${e.error}`);
  for (const w of e.warnings ?? []) parts.push(`⚠ ${w}`);
  return parts.join(' · ') || '–';
}

function duration(ms) {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)} m ${Math.round((ms % 60000) / 1000)} s`;
}

// Keep table cells on one line and free of column breaks.
function cell(text) {
  const s = String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return s.length > 400 ? s.slice(0, 397) + '…' : s;
}
