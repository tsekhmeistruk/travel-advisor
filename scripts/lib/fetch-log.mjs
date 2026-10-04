// Structured log for the fetch scripts. Each script run appends one JSON line describing
// every request it made (status, timing, retries, Cloudflare challenges) and what it produced,
// through the store: logs/fetch/<YYYY>/<YYYY-MM>.jsonl on files, the fetch_runs table on
// SQLite. See logs/README.md.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'logs', 'fetch');

// Cloudflare's bot-check page, served in place of the real content.
const CHALLENGE = /<title>\s*(Just a moment|Attention Required)|challenges\.cloudflare\.com/i;

export function logFile(date = new Date(), root = LOG_ROOT) {
  const iso = date.toISOString();
  return join(root, iso.slice(0, 4), `${iso.slice(0, 7)}.jsonl`);
}

// The run a fetch belongs to: RUN_ID (the backend's update job), else a GitHub Actions run's
// id + attempt (a re-run gets a new attempt), else "local".
export function currentRun(env = process.env) {
  if (env.RUN_ID) return env.RUN_ID;
  const id = env.GITHUB_RUN_ID;
  return id ? `${id}.${env.GITHUB_RUN_ATTEMPT ?? 1}` : 'local';
}

/** What started the run: RUN_TRIGGER (the backend: "schedule", "manual"), else GitHub's event, else "local". */
export function currentTrigger(env = process.env) {
  return env.RUN_TRIGGER ?? env.GITHUB_EVENT_NAME ?? 'local';
}

/**
 * @param opts.store where the line is written (store.appendFetchRun); without one, to the log folder
 * @param opts.root a log folder (tests use a temporary one); it wins over the store
 */
export function startRunLog(source, { root, store, env = process.env } = {}) {
  const started = Date.now();
  const entry = {
    time: new Date(started).toISOString(),
    source,
    run: currentRun(env),
    trigger: currentTrigger(env),
    result: 'ok',
    durationMs: 0,
    calls: {},
    stats: {},
  };

  return {
    // fetch() that records the request under `call`. With `detail`, every attempt is
    // listed; without it (many similar requests, e.g. destination pages) only counts are kept.
    // With `binary`, the body is a Buffer (e.g. a zip file) instead of text.
    async request(call, url, init = {}, { detail = true, binary = false } = {}) {
      const c = entry.calls[call] ??= detail
        ? { url, attempts: [] }
        : { requests: 0, statuses: {}, errors: 0, challenges: 0, totalMs: 0 };
      const t0 = Date.now();
      let rec;
      try {
        const res = await fetch(url, init);
        const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
        rec = { status: res.status, ms: Date.now() - t0 };
        if (CHALLENGE.test(body.toString('utf8', 0, 4000).slice(0, 4000))) rec.challenge = true;
        const retryAfter = res.headers.get('retry-after');
        if (retryAfter) rec.retryAfter = retryAfter;
        return { status: res.status, ok: res.ok && !rec.challenge, challenge: !!rec.challenge, body };
      } catch (err) {
        rec = { error: err.name === 'TimeoutError' ? 'timeout' : (err.cause?.code || err.message), ms: Date.now() - t0 };
        throw err;
      } finally {
        if (detail) {
          c.attempts.push(rec);
        } else {
          c.requests++;
          c.totalMs += rec.ms;
          if (rec.error) c.errors++; else c.statuses[rec.status] = (c.statuses[rec.status] || 0) + 1;
          if (rec.challenge) c.challenges++;
        }
      }
    },
    stat(values) { Object.assign(entry.stats, values); },
    warn(message) { (entry.warnings ??= []).push(message); console.warn(message); },
    fail(err) { entry.result = 'error'; entry.error = err.message; },
    write() {
      entry.durationMs = Date.now() - started;
      if (store && !root) return store.appendFetchRun(entry);
      const file = logFile(new Date(started), root ?? LOG_ROOT);
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify(entry) + '\n');
    },
  };
}

// Runs a fetch script's main function with logging: the log line is always written,
// and a failure sets a non-zero exit code after it has been recorded.
export async function withRunLog(source, main, opts = {}) {
  const log = startRunLog(source, opts);
  try {
    await main(log);
  } catch (err) {
    log.fail(err);
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    log.write();
  }
}
