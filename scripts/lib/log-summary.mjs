// Rendering of the fetch log (logs/fetch/*.jsonl) as Markdown tables. Pure except
// readEntries/providerLabels, which read files; scripts/log-summary.mjs is the CLI.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { logFile } from './fetch-log.mjs';

// rss and pages: calls of earlier runs (change notes), still in the logs.
const CALL_LABELS = { api: 'API', rss: 'RSS', feed: 'Feed', table: 'Table', pages: 'Pages', list: 'List', search: 'Search' };

/** Log entries at or after `sinceMs`, reading each monthly file from then until `now`. */
export function readEntries(sinceMs, { root, now = new Date() } = {}) {
  const out = [];
  const end = now.getUTCFullYear() * 12 + now.getUTCMonth();
  for (let d = new Date(sinceMs); d.getUTCFullYear() * 12 + d.getUTCMonth() <= end; d.setUTCMonth(d.getUTCMonth() + 1, 1)) {
    const file = root ? logFile(d, root) : logFile(d);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (Date.parse(e.time) >= sinceMs) out.push(e);
      } catch { /* skip a damaged line rather than fail the summary */ }
    }
  }
  return out.sort((a, b) => b.time.localeCompare(a.time));
}

/** "🇺🇸 U.S." per provider: flag emoji from config/providers, short name from site/i18n/en.json. */
export function providerLabels(repoRoot) {
  const labels = {};
  try {
    const en = JSON.parse(readFileSync(join(repoRoot, 'site', 'i18n', 'en.json'), 'utf8'));
    for (const dataset of Object.values(en.datasets ?? {})) {
      for (const [id, p] of Object.entries(dataset.providers ?? {})) {
        const cfg = join(repoRoot, 'config', 'providers', `${id}.json`);
        const flag = existsSync(cfg) ? JSON.parse(readFileSync(cfg, 'utf8')).flag : null;
        labels[id] = `${flag ? flagEmoji(flag) + ' ' : ''}${p.short ?? p.name ?? id}`;
      }
    }
    const sources = join(repoRoot, 'config', 'sources');
    for (const f of existsSync(sources) ? readdirSync(sources).filter(x => x.endsWith('.json')) : []) {
      const cfg = JSON.parse(readFileSync(join(sources, f), 'utf8'));
      labels[cfg.id] = `🌐 ${cfg.name ?? cfg.id}`;
    }
  } catch { /* fall back to raw ids */ }
  return labels;
}

export function flagEmoji(code) {
  return String.fromCodePoint(...code.toUpperCase().split('').map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Table of one Actions run's fetches, for its summary page. */
export function renderRunSummary(entries, { labels = {}, logLink } = {}) {
  const lines = ['### Fetch results', ''];
  if (!entries.length) return [...lines, 'No fetch ran in this run.'].join('\n');
  lines.push('| Source | Result | Requests | Data | Time |', '|---|---|---|---|---|');
  for (const e of entries) lines.push(row(e, { labels }));
  if (logLink) lines.push('', `Full log: [\`${logLink.file}\`](${logLink.url})`);
  return lines.join('\n');
}

const STATUS = { healthy: '✅ Healthy', delayed: '⚠️ Delayed', error: '❌ Error' };

/**
 * Table of every provider's and source's health (site/data/risk/health.json), for the run's
 * page: status, last success and failures in a row.
 */
export function renderHealth(health, { labels = {} } = {}) {
  const lines = ['### Source health', ''];
  const entries = Object.entries(health?.sources ?? {});
  if (!entries.length) return [...lines, 'No health data yet.'].join('\n');
  lines.push('| Source | Status | Last success (UTC) | Failures in a row |', '|---|---|---|---|');
  for (const [id, h] of entries) {
    const last = h.lastSuccess ? h.lastSuccess.slice(0, 16).replace('T', ' ') : 'never';
    lines.push(`| ${cell(labels[id] ?? id)} | ${STATUS[h.status] ?? h.status} | ${last} | ${h.consecutiveFailures ?? 0}${h.error ? ` (${cell(h.error)})` : ''} |`);
  }
  return lines.join('\n');
}

/** Table of every run in the last `days` days. */
export function renderRecent(entries, { labels = {}, days }) {
  const lines = [`Fetch runs in the last ${days} days`, ''];
  if (!entries.length) return [...lines, 'No runs logged.'].join('\n');
  lines.push('| When (UTC) | Trigger | Source | Result | Requests | Data | Time |', '|---|---|---|---|---|---|---|');
  for (const e of entries) lines.push(row(e, { labels, withWhen: true }));
  return lines.join('\n');
}

export function row(e, { labels = {}, withWhen = false } = {}) {
  const cells = [
    labels[e.source] ?? e.source,
    result(e),
    Object.entries(e.calls ?? {}).map(([name, c]) => `${CALL_LABELS[name] ?? name}: ${callSummary(c)}`).join('<br>') || '–',
    describe(e),
    duration(e.durationMs),
  ];
  if (withWhen) cells.unshift(e.time.slice(0, 16).replace('T', ' '), e.trigger);
  return `| ${cells.map(cell).join(' | ')} |`;
}

export function result(e) {
  if (e.result !== 'ok') return '❌ Failed';
  if (Object.values(e.calls ?? {}).some(c => (c.attempts?.length ?? 0) > 1)) return '⚠️ OK after retry';
  if (e.warnings?.length) return '⚠️ OK with warnings';
  return '✅ OK';
}

/** Detailed calls list each attempt ("429 → 200"); aggregated ones show counts ("6× 200"). */
export function callSummary(c) {
  if (c.attempts) {
    return c.attempts.map(a => a.error ? `✗ ${a.error}` : a.challenge ? `${a.status} challenge` : String(a.status)).join(' → ');
  }
  if (!c.requests) return 'none';
  const parts = Object.entries(c.statuses).map(([s, n]) => `${n}× ${s}`);
  if (c.errors) parts.push(`${c.errors}× error`);
  if (c.challenges) parts.push(`${c.challenges}× challenge`);
  return parts.join(', ');
}

/** What a run produced, from whichever stats its provider reports. */
export function describe(e) {
  const s = e.stats ?? {};
  const parts = [];
  if (s.advisories != null) parts.push(`${s.advisories} advisories`);
  if (s.destinations != null) parts.push(`${s.destinations} destinations${s.sources ? ` (${s.sources.join(' + ')})` : ''}`);
  if (s.events != null) parts.push(s.current != null ? `${s.events} events (${s.current} current)` : `${s.events} events`);
  // A conflict source (UCDP): the monthly versions.
  if (Array.isArray(s.fetched)) parts.push(s.fetched.length ? `new: ${s.fetched.join(', ')}, data through ${s.through}` : `no new version, data through ${s.through}`);
  if (s.refetched?.length) parts.push(`${s.refetched.length} downloaded again (a newer stored format)`);
  // A context source (Wikipedia): the articles.
  if (s.articles != null) parts.push(`${s.fetched} of ${s.articles} articles read`);
  if (Array.isArray(s.failed) && s.failed.length) parts.push(`last copy kept: ${s.failed.join(', ')}`);
  if (s.noInfobox?.length) parts.push(`${s.noInfobox.length} without a war infobox`);
  if (s.alertChanged?.length) parts.push(`🔔 alert changed: ${s.alertChanged.join(', ')}`);
  if (s.added?.length) parts.push(s.added.length <= 6 ? `new: ${s.added.join(', ')}` : `${s.added.length} new`);
  if (s.archived) parts.push(`${s.archived} archived`);
  if (s.counted) parts.push(s.counted.length ? `${s.counted.length} day(s) counted, through ${s.through}` : `up to date, through ${s.through}`);
  if (s.gaps?.length) parts.push(`no file for ${s.gaps.join(', ')}`);
  // The event the site shows: a level went up or down (confirmed, for sources that need it).
  const levelChanges = [...(s.levelChanged ?? []), ...(s.levelChangesConfirmed ?? [])];
  if (levelChanges.length) parts.push(`🔔 level changed: ${levelChanges.join(', ')}`);
  if (s.keptFromPrevious?.length) parts.push(`${s.keptFromPrevious.length} kept from previous (${s.keptFromPrevious.join(', ')})`);
  if (s.changeNotes != null) parts.push(`${s.changeNotes} change notes`);
  if (s.changed !== undefined) {
    parts.push(Array.isArray(s.changed)
      ? (s.changed.length === 0 ? 'none updated' : s.changed.length <= 6 ? `updated: ${s.changed.join(', ')}` : `${s.changed.length} updated`)
      : `${s.changed} read`);
  }
  if (s.newerThanFeed?.length) parts.push(`${s.newerThanFeed.length} newer than the feed`);
  if (s.pagesFailed) parts.push(`${s.pagesFailed} pages failed`);
  if (s.severestFallback?.length) parts.push(`level by fallback: ${s.severestFallback.join(', ')}`);
  if (s.levelChangesPending) parts.push(`${s.levelChangesPending} level changes awaiting confirmation`);
  if (e.error) parts.push(`Error: ${e.error}`);
  for (const w of e.warnings ?? []) parts.push(`⚠ ${w}`);
  return parts.join(' · ') || '–';
}

export function duration(ms) {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)} m ${Math.round((ms % 60000) / 1000)} s`;
}

/** Keep a table cell on one line and free of column breaks. */
export function cell(text) {
  const s = String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return s.length > 400 ? s.slice(0, 397) + '…' : s;
}
