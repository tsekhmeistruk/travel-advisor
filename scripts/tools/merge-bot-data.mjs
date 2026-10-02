// When the bot committed data while you worked: merge origin/main and settle the usual data
// conflicts, then rebuild and commit.
//   - logs/fetch/*.jsonl: both sides' lines, in time order;
//   - data/sources-state.json: per source, the side with the newer lastAttempt;
//   - site/data/**: ours, then rebuilt from the merged inputs (npm run build).
// Any other conflict stops it (exit 1) for a look. Run `git fetch` first.
//
//   npm run merge-bot-data

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const git = (cmd, opts = {}) => execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const side = (n, f) => git(`show :${n}:${f}`);

try { git('merge origin/main --no-edit -m "Merge the bot\'s data update"'); } catch { /* conflicts: settled below */ }
const conflicts = git('diff --name-only --diff-filter=U').split('\n').filter(Boolean);
for (const f of conflicts) {
  if (/^logs\/fetch\/.*\.jsonl$/.test(f)) {
    const lines = [...new Set([...side(2, f).split('\n'), ...side(3, f).split('\n')].filter(Boolean))];
    lines.sort((a, b) => JSON.parse(a).time.localeCompare(JSON.parse(b).time));
    writeFileSync(f, `${lines.join('\n')}\n`);
  } else if (f === 'data/sources-state.json') {
    const a = JSON.parse(side(2, f)), b = JSON.parse(side(3, f));
    const out = {};
    for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) out[id] = (a[id]?.lastAttempt ?? '') > (b[id]?.lastAttempt ?? '') ? a[id] : b[id];
    writeFileSync(f, `${JSON.stringify(out, null, 1)}\n`);
  } else if (f.startsWith('site/data/')) {
    git(`checkout --ours -- "${f}"`);
  } else {
    console.error(`Conflict needs a look: ${f}`);
    process.exit(1);
  }
  git(`add -- "${f}"`);
}
let merging = true;
try { git('rev-parse -q --verify MERGE_HEAD'); } catch { merging = false; }   // a clean merge already committed itself
if (merging) {
  execSync('node scripts/build.mjs', { stdio: 'ignore' });
  git('add site/data data');
  git('commit -q --no-edit');
}
console.log(git('log --oneline -3'));
