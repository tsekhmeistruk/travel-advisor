// Runs the browser tests with a visible browser window (cross-platform, no dependencies).
//
// Usage: npm run test:e2e:headed                  (starts its own server)
//        E2E_BASE_URL=http://localhost:8080/ npm run test:e2e:headed   (uses a running one)
//        SLOWMO=100 npm run test:e2e:headed       (slower, easier to follow; default 40 ms)

import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'tests/e2e/*.test.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, HEADED: '1', SLOWMO: process.env.SLOWMO ?? '40' },
});
process.exit(result.status ?? 1);
