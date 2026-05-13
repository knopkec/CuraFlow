import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..');
const defaultEnvPath = path.join(repoRoot, '.env.test');

export function loadOptionalTestEnv(envPath = defaultEnvPath) {
  if (!fs.existsSync(envPath)) {
    return { loaded: false, path: envPath };
  }

  dotenv.config({ path: envPath, override: false });
  return { loaded: true, path: envPath };
}
