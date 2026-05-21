import fs from 'node:fs';

const BASE_URL = process.env.CURAFLOW_SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const ADMIN_EMAIL = process.env.CURAFLOW_SMOKE_ADMIN_EMAIL || 'demo-admin@curaflow.local';
const DEMO_ENV_FILE = process.env.CURAFLOW_SMOKE_ENV_FILE || '.env.demo';
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_INTERVAL_MS = 2_000;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((values, line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        return values;
      }

      const separatorIndex = trimmedLine.indexOf('=');
      if (separatorIndex === -1) {
        return values;
      }

      const key = trimmedLine.slice(0, separatorIndex);
      const value = trimmedLine.slice(separatorIndex + 1);
      return { ...values, [key]: value };
    }, {});
}

const demoEnv = readEnvFile(DEMO_ENV_FILE);
const ADMIN_PASSWORD = process.env.CURAFLOW_SMOKE_ADMIN_PASSWORD
  || process.env.CURAFLOW_DEMO_ADMIN_PASSWORD
  || demoEnv.CURAFLOW_DEMO_ADMIN_PASSWORD;

function assertConfig() {
  if (!ADMIN_PASSWORD) {
    throw new Error('A demo smoke admin password is required via environment or the demo env file');
  }
}

async function waitForHealth() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for ${BASE_URL}/health`);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${url} failed (${response.status}): ${text}`);
  }

  return body;
}

async function login() {
  const loginData = await fetchJson(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    }),
  });

  const authorization = { Authorization: `Bearer ${loginData.token}` };
  const tenantsData = await fetchJson(`${BASE_URL}/api/auth/my-tenants`, {
    headers: authorization,
  });
  const tenantId = tenantsData.tenants?.[0]?.id;

  if (!tenantId) {
    throw new Error('No demo tenant was returned for the admin user');
  }

  const tenantActivation = await fetchJson(`${BASE_URL}/api/auth/activate-tenant/${tenantId}`, {
    method: 'POST',
    headers: authorization,
  });

  if (!tenantActivation.token) {
    throw new Error('Tenant activation did not return a DB token');
  }

  return {
    headers: authorization,
    dbToken: tenantActivation.token,
  };
}

async function queryDb(table, payload, { headers, dbToken }) {
  return fetchJson(`${BASE_URL}/api/db`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-DB-Token': dbToken,
    },
    body: JSON.stringify({
      table,
      ...payload,
    }),
  });
}

async function assertHtmlShell() {
  const response = await fetch(BASE_URL);
  const html = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok || !contentType.includes('text/html') || !html.toLowerCase().includes('<html')) {
    throw new Error(`Expected frontend HTML shell at ${BASE_URL}`);
  }
}

async function assertCurrentDemoData(session) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const shifts = await queryDb('ShiftEntry', { action: 'list', limit: 50 }, session);
  const wishes = await queryDb('WishRequest', {
    action: 'filter',
    query: { target_month: currentMonth },
  }, session);
  const rotations = await queryDb('TrainingRotation', { action: 'list', limit: 20 }, session);
  const staffing = await queryDb('StaffingPlanEntry', {
    action: 'filter',
    query: { year: Number(currentMonth.slice(0, 4)) },
  }, session);

  if (!Array.isArray(shifts) || shifts.length === 0) {
    throw new Error('Expected seeded ShiftEntry rows in the demo tenant');
  }

  if (!Array.isArray(wishes) || wishes.length === 0) {
    throw new Error(`Expected seeded WishRequest rows for ${currentMonth}`);
  }

  if (!Array.isArray(rotations) || rotations.length === 0) {
    throw new Error('Expected seeded TrainingRotation rows in the demo tenant');
  }

  if (!Array.isArray(staffing) || staffing.length === 0) {
    throw new Error(`Expected seeded StaffingPlanEntry rows for ${currentMonth.slice(0, 4)}`);
  }
}

async function main() {
  assertConfig();
  await waitForHealth();
  await assertHtmlShell();
  const session = await login();
  await assertCurrentDemoData(session);
  process.stdout.write('Demo smoke checks passed.\n');
}

main().catch((error) => {
  console.error('[demo-smoke] Failed:', error);
  process.exitCode = 1;
});
