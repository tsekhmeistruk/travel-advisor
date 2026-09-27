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
import { PROVIDERS } from '../../scripts/providers/index.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const store = new FileStore();
const en = store.locale('en');
const has = (key) => key.split('.').reduce((n, p) => (n == null ? undefined : n[p]), en) !== undefined;
const updateWorkflow = read('.github/workflows/update-advisories.yml');
const deployWorkflow = read('.github/workflows/deploy.yml');

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
      // Whole word: "fetch.mjs ca" must not be satisfied by "fetch.mjs canada".
      assert.match(updateWorkflow, new RegExp(`node scripts/fetch\\.mjs ${p}(\\s|$)`), 'fetch step in update-advisories.yml');
      assert.ok(updateWorkflow.includes(`steps.${p}.outcome`), 'included in the workflow failure conditions');
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
  test('runs on pushes to main and when the daily update calls it', () => {
    assert.match(deployWorkflow, /push:\n\s+branches: \[main\]/);
    assert.match(deployWorkflow, /workflow_call:/);
    assert.match(updateWorkflow, /uses: \.\/\.github\/workflows\/deploy\.yml/);
  });
  test('the daily update commits the data the site loads', () => {
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
