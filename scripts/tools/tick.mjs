// Tick items in a plan checklist (docs/plans/<name>.md) as they are done, and update its
// Status block and Log. The owner follows progress there, and an interrupted session resumes
// from the first unchecked box. The format: "- [ ] 1.2 …" items, "- [ ] text" sub-items, and
//   ## Status
//   - **Current step:** …
//   - **Done:** …
//   - **Last commit of this revision:** …
//   ## Log (…)
//   - (empty)
//
//   npm run tick -- docs/plans/x.md 1.1,1.2 --sub "e2e: a link" --current 1.3 --done "part 0; 1.1–1.2" --last "abc123" --log "Part 1: …"

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: o, positionals: [file, ids = ''] } = parseArgs({
  allowPositionals: true,
  options: { sub: { type: 'string', multiple: true, default: [] }, current: { type: 'string' }, done: { type: 'string' }, last: { type: 'string' }, log: { type: 'string' } },
});
if (!file) throw new Error('usage: tick.mjs <doc> [ids] [--sub text] [--current x] [--done x] [--last x] [--log line]');
let s = readFileSync(file, 'utf8');
for (const id of ids.split(',').filter(Boolean)) {
  const re = new RegExp(`^(\\s*)- \\[ \\] ${id.replace(/\./g, '\\.')} `, 'm');
  if (!re.test(s)) throw new Error(`no unchecked item ${id}`);
  s = s.replace(re, (m) => m.replace('[ ]', '[x]'));
}
for (const text of o.sub) {
  const i = s.indexOf(`- [ ] ${text}`);
  if (i < 0) throw new Error(`no unchecked sub-item starting "${text}"`);
  s = `${s.slice(0, i)}- [x]${s.slice(i + 5)}`;
}
const set = (label, value) => { if (value) s = s.replace(new RegExp(`^- \\*\\*${label}:\\*\\* .*$`, 'm'), () => `- **${label}:** ${value}`); };
set('Current step', o.current);
set('Done', o.done);
set('Last commit of this revision', o.last);
if (o.log) {
  s = s.replace(/^- \(empty\)\n?/m, '');
  s = `${s.replace(/\n*$/, '')}\n- ${o.log}\n`;
}
writeFileSync(file, s);
console.log(`${file}: ${(s.match(/- \[ \]/g) ?? []).length} unchecked`);
