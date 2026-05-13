import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadOptionalTestEnv } from '../../scripts/load-test-env.js';

export type SeededRole = 'admin' | 'user' | 'readonly';

loadOptionalTestEnv();

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(currentDir, '../..');
export const frontendPort = Number(process.env.PLAYWRIGHT_FRONTEND_PORT || '4173');
export const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${frontendPort}`;
export const backendURL = process.env.PLAYWRIGHT_BACKEND_URL || 'http://127.0.0.1:3100';
export const authStateDir = path.join(repoRoot, 'e2e', '.auth');

export const requiredHarnessEnvNames = [
  'TEST_MYSQL_ROOT_PASSWORD',
  'TEST_MYSQL_PASSWORD',
  'TEST_JWT_SECRET',
  'SEED_ADMIN_PASSWORD',
  'SEED_USER_PASSWORD',
  'SEED_READONLY_PASSWORD',
] as const;

export const storageStatePaths = {
  admin: path.join(authStateDir, 'admin.json'),
  user: path.join(authStateDir, 'user.json'),
  readonly: path.join(authStateDir, 'readonly.json'),
} as const;

export const seededUsers = {
  admin: {
    email: 'admin@test.local',
    passwordEnv: 'SEED_ADMIN_PASSWORD',
    storageStatePath: storageStatePaths.admin,
  },
  user: {
    email: 'user@test.local',
    passwordEnv: 'SEED_USER_PASSWORD',
    storageStatePath: storageStatePaths.user,
  },
  readonly: {
    email: 'readonly@test.local',
    passwordEnv: 'SEED_READONLY_PASSWORD',
    storageStatePath: storageStatePaths.readonly,
  },
} as const;

export function getHarnessEnv() {
  const env = { ...process.env };

  for (const name of requiredHarnessEnvNames) {
    if (!env[name]) {
      throw new Error(`${name} is required to run the Playwright UI harness`);
    }
  }

  return env;
}

export function getUserPassword(role: SeededRole) {
  const envName = seededUsers[role].passwordEnv;
  const password = process.env[envName];

  if (!password) {
    throw new Error(`${envName} is required to run the Playwright smoke tests`);
  }

  return password;
}

export function getTenantId() {
  return process.env.TEST_TENANT_ID || 'tenant-main';
}
