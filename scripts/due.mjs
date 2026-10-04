// Prints which providers and sources are due for a fetch (rules in lib/schedule.mjs), and
// writes them to $GITHUB_OUTPUT for the update workflow:
//   due=,us,gdacs,   (comma-wrapped, so a step can test contains(..., ',us,'))
//   any=true|false
//   jitter=true|false
//
// Environment: EVENT (github.event_name), SEED (the repository), SOURCES (a manual run's
// input: "all", ids, or "due"). "due" makes a manual run behave like a scheduled one, for an
// external scheduler that starts the workflow through the API. Usage: node scripts/due.mjs

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dueSources } from './lib/schedule.mjs';
import { createStore } from './lib/store.mjs';

/** The due list and one summary line per id. */
export function runDue({ store = createStore(), env = process.env, now = new Date() } = {}) {
  const result = dueSources({
    schedule: store.schedule(), state: store.sourcesState(), now,
    seed: env.SEED ?? 'local', manual: env.EVENT === 'workflow_dispatch' && env.SOURCES?.trim() !== 'due', only: env.SOURCES ?? '',
  });
  const lines = Object.entries(result.reasons).map(([id, why]) => `${result.due.includes(id) ? 'run ' : 'skip'} ${id}: ${why}`);
  return { ...result, output: `due=,${result.due.join(',')},\nany=${result.due.length > 0}\njitter=${result.jitter}\n`, lines };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { output, lines } = runDue();
  console.log(`now ${new Date().toISOString().slice(0, 16)} UTC\n${lines.join('\n')}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
}
