import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';

import type { FullConfig } from '@playwright/test';

import {
  authStateDir,
  backendURL,
  baseURL,
  getHarnessEnv,
  getTenantId,
  getUserPassword,
  repoRoot,
  seededUsers,
} from './support/config';

const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_INTERVAL_MS = 2_000;

function runCommand(command: string, env: NodeJS.ProcessEnv) {
  execSync(command, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
}

async function waitForHealth() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    try {
      const response = await fetch(`${backendURL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the backend responds or timeout is reached.
    }

    await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for ${backendURL}/health`);
}

async function authenticateUser(email: string, password: string) {
  const loginResponse = await fetch(`${backendURL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!loginResponse.ok) {
    const body = await loginResponse.text();
    throw new Error(`Failed to log in seeded user ${email}: ${loginResponse.status} ${body}`);
  }

  const loginData = await loginResponse.json();
  const authHeader = { Authorization: `Bearer ${loginData.token}` };

  const tenantsResponse = await fetch(`${backendURL}/api/auth/my-tenants`, {
    headers: authHeader,
  });

  if (!tenantsResponse.ok) {
    const body = await tenantsResponse.text();
    throw new Error(`Failed to load tenants for ${email}: ${tenantsResponse.status} ${body}`);
  }

  const tenantsData = await tenantsResponse.json();
  const tenantId = tenantsData.tenants?.[0]?.id || getTenantId();

  const activateResponse = await fetch(`${backendURL}/api/auth/activate-tenant/${tenantId}`, {
    method: 'POST',
    headers: authHeader,
  });

  if (!activateResponse.ok) {
    const body = await activateResponse.text();
    throw new Error(`Failed to activate tenant ${tenantId} for ${email}: ${activateResponse.status} ${body}`);
  }

  const activateData = await activateResponse.json();

  if (!activateData.token) {
    throw new Error(`Tenant activation for ${email} did not return a db token`);
  }

  return {
    jwtToken: loginData.token,
    dbToken: activateData.token,
    tenantId,
  };
}

async function writeStorageState(path: string, values: { jwtToken: string; dbToken: string; tenantId: string }) {
  const state = {
    cookies: [],
    origins: [
      {
        origin: new URL(baseURL).origin,
        localStorage: [
          { name: 'radioplan_jwt_token', value: values.jwtToken },
          { name: 'db_credentials', value: values.dbToken },
          { name: 'db_token_enabled', value: 'true' },
          { name: 'active_token_id', value: values.tenantId },
        ],
      },
    ],
  };

  await fs.writeFile(path, JSON.stringify(state, null, 2));
}

export default async function globalSetup(_config: FullConfig) {
  const env = getHarnessEnv();

  await fs.mkdir(authStateDir, { recursive: true });

  runCommand('npm run test:db:up', env);
  await waitForHealth();

  runCommand('npm run test:db:seed', env);
  await waitForHealth();

  for (const [role, user] of Object.entries(seededUsers)) {
    const authState = await authenticateUser(user.email, getUserPassword(role as keyof typeof seededUsers));
    await writeStorageState(user.storageStatePath, authState);
  }
}
