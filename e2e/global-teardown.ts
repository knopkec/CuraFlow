import { execSync } from 'node:child_process';

import { getHarnessEnv, repoRoot } from './support/config';

export default async function globalTeardown() {
  execSync('npm run test:db:down', {
    cwd: repoRoot,
    env: getHarnessEnv(),
    stdio: 'inherit',
  });
}
