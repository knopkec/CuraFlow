import { execSync, spawnSync } from 'node:child_process';

function resolveBuildSha() {
  const explicitSha = process.env.VITE_APP_COMMIT_SHA?.trim();
  if (explicitSha) {
    return explicitSha;
  }

  try {
    return execSync('git rev-parse HEAD', {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return '';
  }
}

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error('Usage: node scripts/with-build-sha.js <command> [...args]');
  process.exit(1);
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_APP_COMMIT_SHA: resolveBuildSha(),
  },
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
