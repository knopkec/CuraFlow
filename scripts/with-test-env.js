import { spawnSync } from 'node:child_process';

import { loadOptionalTestEnv } from './load-test-env.js';

loadOptionalTestEnv();

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error('Usage: node scripts/with-test-env.js <command> [...args]');
  process.exit(1);
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
