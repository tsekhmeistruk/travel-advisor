// Project consistency: everything a provider needs is wired up, every translation key the
// code uses exists, the deploy gate is intact, and no secrets are committed. These catch
// mistakes that the other suites can't, e.g. a provider missing from the daily workflow.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileStore } from '../../scripts/lib/store.mjs';
import { PROVIDERS, SOURCES } from '../../scripts/providers/index.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const store = new FileStore();
const en = store.locale('en');
const has = (key) => key.split('.').reduce((n, p) => (n == null ? undefined : n[p]), en) !== undefined;
const updateWorkflow = read('.github/workflows/update.yml');
const deployWorkflow = read('.github/workflows/deploy.yml');
const schedule = store.schedule();

// A fetch step that runs when the due check lists the id, and counts in the failure report.
// Whole word: "fetch.mjs ca" must not be satisfied by "fetch.mjs canada".
function assertInWorkflow(id) {
  assert.match(updateWorkflow, new RegExp(`node scripts/fetch\\.mjs ${id}(\\s|$)`), 'fetch step in update.yml');
  assert.ok(updateWorkflow.includes(`contains(steps.due.outputs.due, ',${id},')`), 'the fetch step runs only when due');
  assert.ok(updateWorkflow.includes(`steps.${id}.outcome`), 'included in the workflow failure conditions');
  assert.ok(schedule[id], 'scheduled in config/schedule.json');
}

describe('providers are wired up everywhere', () => {
  const listed = store.datasetIds().flatMap(ds => store.dataset(ds).providers.map(p => ({ ds, p })));

  for (const { ds, p } of listed) {
    test(`${ds}/${p}`, () => {
      const cfg = store.provider(p);
      assert.equal(cfg.id, p, 'config id');
      assert.equal(cfg.dataset, ds, 'config dataset');
      assert.ok(PROVIDERS[p], 'module registered in scripts/providers/index.mjs');
      assert.equal(PROVIDERS[p].dataset, ds, 'module dataset');
      assert.ok(existsSync(join(ROOT, 'site', 'assets', 'flags', `${cfg.flag}.svg`)), `flag site/assets/flags/${cfg.flag}.svg`);
      assertInWorkflow(p);
      assert.ok(cfg.links?.list?.startsWith('https://'), 'links.list');
    });
  }

  test('every registered provider module is used by a dataset', () => {
    const used = new Set(listed.map(x => x.p));
    assert.deepEqual(Object.keys(PROVIDERS).filter(id => !used.has(id)), []);
  });

  test('provider aliases, coveredBy, home and territories refer to known places', () => {
    const ids = new Set(store.places().map(p => p.id));
    for (const { p } of listed) {
      const cfg = store.provider(p);
      const refs = [cfg.home, ...(cfg.territories ?? []), ...Object.keys(cfg.coveredBy ?? {}), ...Object.values(cfg.aliases ?? {}).flat()];
      assert.deepEqual(refs.filter(id => !ids.has(id)), [], `${p}: unknown place ids`);
    }
  });
});

describe('risk sources are wired up everywhere', () => {
  const categories = new Set(store.categories().categories.map(c => c.id));
  const placeIds = new Set(store.places().map(p => p.id));

  for (const id of store.sourceIds()) {
    test(id, () => {
      const cfg = store.source(id);
      assert.equal(cfg.id, id, 'config id');
      assert.ok(SOURCES[id], 'module registered in scripts/providers/index.mjs');
      assert.equal(SOURCES[id].kind, 'events', 'module kind');
      assert.ok(cfg.name && cfg.type && cfg.authority, 'name, type and authority');
      assert.ok(cfg.links?.home?.startsWith('https://') && cfg.links?.terms?.startsWith('https://'), 'links to the source and its terms');
      assert.ok(cfg.staleAfterHours > 0 && cfg.confirmFallMinutes >= 0, 'staleAfterHours, confirmFallMinutes');
      for (const [code, t] of Object.entries(cfg.types)) {
        assert.ok(categories.has(t.category), `${code}: category ${t.category} is in config/categories.json`);
        assert.ok(t.type && t.tailDays >= 0, `${code}: type and tailDays`);
      }
      for (const level of Object.values(cfg.levels)) assert.ok(store.categories().scale.values.includes(level), `level ${level}`);
      assert.deepEqual(Object.values(cfg.codes ?? {}).flat().filter(p => !placeIds.has(p)), [], 'codes refer to known places');
      assertInWorkflow(id);
    });
  }

  test('every registered source module has a config', () => {
    assert.deepEqual(Object.keys(SOURCES).filter(id => !store.sourceIds().includes(id)), []);
  });

  test('config/schedule.json lists exactly the providers and sources', () => {
    assert.deepEqual(Object.keys(schedule).sort(), [...Object.keys(PROVIDERS), ...Object.keys(SOURCES)].sort());
  });
});

describe('translation keys used by the code exist', () => {
  test('every data-i18n key in index.html', () => {
    const html = read('site/index.html');
    const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map(m => m[1]);
    assert.ok(keys.length > 10);
    assert.deepEqual(keys.filter(k => !has(k)), []);
  });

  test('every literal t(\'…\') key in the app and UI modules', () => {
    const files = ['site/js/main.js', ...readdirSync(join(ROOT, 'site/js/ui')).map(f => `site/js/ui/${f}`)];
    const keys = files.flatMap(f => [...read(f).matchAll(/\bt\('([^'$]+)'/g)].map(m => m[1]));
    assert.ok(keys.length > 3);
    assert.deepEqual(keys.filter(k => !has(k)), []);
  });

  test('every literal tx(\'…\') key in each dataset module', () => {
    for (const ds of store.datasetIds()) {
      const file = `site/js/datasets/${ds}/index.js`;
      const keys = [...read(file).matchAll(/\btx\('([^'$]+)'/g)].map(m => `datasets.${ds}.${m[1]}`);
      assert.ok(keys.length > 20, file);
      assert.deepEqual(keys.filter(k => !has(k)), [], file);
    }
  });

  test('every literal tr(\'…\') key in the risk modes, and every risk level, category and event type', () => {
    const file = 'site/js/datasets/risk/index.js';
    const keys = [...read(file).matchAll(/\btr\('([^'$]+)'/g)].map(m => `risk.${m[1]}`);
    assert.ok(keys.length > 30, file);
    assert.deepEqual(keys.filter(k => !has(k)), [], file);
    const levels = store.categories().scale.values.map(l => `risk.levels.${l}`);
    const categories = store.categories().categories.map(c => `risk.categories.${c.id}`);
    const sources = store.sourceIds().flatMap(id => {
      const cfg = store.source(id);
      return [`risk.sources.${id}`, ...Object.values(cfg.types).map(t => `risk.eventTypes.${t.type}`), ...Object.keys(cfg.levels).map(a => `risk.alerts.${a}`)];
    });
    assert.deepEqual([...levels, ...categories, ...sources].filter(k => !has(k)), []);
  });

  test('every locale file is valid and names itself', () => {
    for (const code of store.locales()) {
      const messages = store.locale(code);
      assert.ok(messages.meta?.name, `${code}: meta.name`);
      assert.ok(['ltr', 'rtl'].includes(messages.meta?.dir), `${code}: meta.dir`);
    }
  });
});

describe('deploy gate', () => {
  test('deploys only after the test job, and publishes only site/', () => {
    assert.match(deployWorkflow, /\n {2}deploy:\n {4}needs: test\n/);
    assert.match(deployWorkflow, /run: npm run test:coverage\n/);
    assert.match(deployWorkflow, /run: npm run test:e2e\n/);
    assert.match(JSON.parse(read('package.json')).scripts['test:coverage'], /--test-coverage-lines=\d+/, 'coverage thresholds enforced');
    assert.match(deployWorkflow, /upload-pages-artifact@[^\n]+\n\s+with:\n\s+path: site\n/);
  });
  test('runs on pushes to main and when the update calls it', () => {
    assert.match(deployWorkflow, /push:\n\s+branches: \[main\]/);
    assert.match(deployWorkflow, /workflow_call:/);
    assert.match(updateWorkflow, /uses: \.\/\.github\/workflows\/deploy\.yml/);
  });
  test('the update runs hourly, asks the due check first, and commits the data the site loads', () => {
    assert.match(updateWorkflow, /cron: '\d+ \* \* \* \*'/);
    assert.match(updateWorkflow, /id: due\n(?:.*\n)*?\s+run: node scripts\/due\.mjs\n/);
    assert.ok(updateWorkflow.indexOf('scripts/due.mjs') < updateWorkflow.indexOf('scripts/fetch.mjs'), 'due check before the fetches');
    assert.match(updateWorkflow, /git add data logs site\/data/);
  });
  test('npm scripts point at files that exist', () => {
    const scripts = JSON.parse(read('package.json')).scripts;
    for (const [name, cmd] of Object.entries(scripts)) {
      for (const [, file] of cmd.matchAll(/node (scripts\/[\w./-]+\.mjs)/g)) assert.ok(existsSync(join(ROOT, file)), `${name}: ${file}`);
    }
  });
});

describe('no secrets or personal data committed', () => {
  // Tracked files (or everything, outside a git checkout), minus this test's own patterns.
  function trackedFiles() {
    try {
      return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    } catch {
      const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap(f => {
        const rel = dir ? `${dir}/${f}` : f;
        if (['node_modules', '.git', 'test-output'].includes(f)) return [];
        return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
      });
      return walk('');
    }
  }
  const PATTERNS = [
    [/gh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
    [/github_pat_[A-Za-z0-9_]{20,}/, 'GitHub token'],
    [/AKIA[0-9A-Z]{16}/, 'AWS key'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
    [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
    [/sk-(ant-)?[A-Za-z0-9_-]{30,}/, 'API key'],
    [/\b[A-Za-z0-9._%+-]+@gmail\.com\b/, 'personal email'],
    [/[A-Z]:[\\/]Users[\\/][^\\/\s"']+[\\/]AppData/, 'personal file path'],
  ];

  test('tracked files contain no tokens, keys, personal emails or personal paths', () => {
    const self = 'tests/data/project.test.mjs';
    const findings = [];
    for (const file of trackedFiles().filter(f => f !== self && !f.endsWith('.png'))) {
      const full = join(ROOT, file);
      if (!existsSync(full) || statSync(full).size > 5e6) continue;
      const text = readFileSync(full, 'utf8');
      for (const [re, what] of PATTERNS) if (re.test(text)) findings.push(`${file}: ${what}`);
    }
    assert.deepEqual(findings, []);
  });
});
