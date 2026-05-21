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
const HEALTH_REQUEST_TIMEOUT_MS = 5_000;
const API_REQUEST_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function runCommand(command: string, env: NodeJS.ProcessEnv) {
  execSync(command, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
}

async function waitForHealth() {
  const startedAt = Date.now();
  let attempts = 0;

  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    attempts += 1;

    try {
      const response = await fetchWithTimeout(
        `${backendURL}/health`,
        {},
        HEALTH_REQUEST_TIMEOUT_MS
      );
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the backend responds or timeout is reached.
    }

    await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for ${backendURL}/health after ${attempts} attempts`);
}

async function authenticateUser(email: string, password: string) {
  const loginResponse = await fetchWithTimeout(`${backendURL}/api/auth/login`, {
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

  const tenantsResponse = await fetchWithTimeout(`${backendURL}/api/auth/my-tenants`, {
    headers: authHeader,
  });

  if (!tenantsResponse.ok) {
    const body = await tenantsResponse.text();
    throw new Error(`Failed to load tenants for ${email}: ${tenantsResponse.status} ${body}`);
  }

  const tenantsData = await tenantsResponse.json();
  const tenantId = tenantsData.tenants?.[0]?.id || getTenantId();

  const activateResponse = await fetchWithTimeout(`${backendURL}/api/auth/activate-tenant/${tenantId}`, {
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

  console.log('[e2e] Starting backend harness');
  runCommand('npm run test:db:up', env);
  console.log('[e2e] Waiting for backend health');
  await waitForHealth();

  console.log('[e2e] Seeding deterministic test data');
  runCommand('npm run test:db:seed', env);
  console.log('[e2e] Re-checking backend health after seeding');
  await waitForHealth();

  for (const [role, user] of Object.entries(seededUsers)) {
    console.log(`[e2e] Generating storage state for ${role}`);
    const authState = await authenticateUser(user.email, getUserPassword(role as keyof typeof seededUsers));
    await writeStorageState(user.storageStatePath, authState);
  }
}
