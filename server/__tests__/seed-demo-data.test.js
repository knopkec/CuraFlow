import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

function demoCredential(label) {
  return `${label}-${'x'.repeat(16)}`;
}

async function importSafetyModule(envOverrides = {}) {
  process.env = {
    ...ORIGINAL_ENV,
    CURAFLOW_DEMO_SEED: '1',
    CURAFLOW_INSTANCE_KIND: 'demo',
    CURAFLOW_DEMO_TENANT_ID: 'demo-tenant-main',
    CURAFLOW_DEMO_TENANT_NAME: 'CuraFlow Demo Tenant',
    MYSQL_URL: `curaflow:${demoCredential('mysql')}@tcp(mysql:3306)/curaflow_demo_master?parseTime=true`,
    CURAFLOW_TENANT_MYSQL_URL: `curaflow:${demoCredential('mysql')}@tcp(mysql:3306)/curaflow_demo_tenant?parseTime=true`,
    CURAFLOW_DEMO_ADMIN_PASSWORD: demoCredential('admin'),
    CURAFLOW_DEMO_USER_PASSWORD: demoCredential('user'),
    CURAFLOW_DEMO_READONLY_PASSWORD: demoCredential('readonly'),
    CURAFLOW_DEMO_RESET_PASSWORD: demoCredential('reset'),
    ...envOverrides,
  };

  vi.resetModules();
  return import('../scripts/seed-demo-data-safety.js');
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('seed-demo-data safety guards', () => {
  it('accepts demo-only database targets', async () => {
    const module = await importSafetyModule();

    expect(() => module.assertSafeDemoEnvironment()).not.toThrow();
  });

  it('rejects missing demo flag', async () => {
    const module = await importSafetyModule({ CURAFLOW_DEMO_SEED: '0' });

    expect(() => module.assertSafeDemoEnvironment()).toThrow(
      'CURAFLOW_DEMO_SEED=1 is required for demo seeding'
    );
  });

  it('rejects non-demo instance kinds', async () => {
    const module = await importSafetyModule({ CURAFLOW_INSTANCE_KIND: 'production' });

    expect(() => module.assertSafeDemoEnvironment()).toThrow(
      'CURAFLOW_INSTANCE_KIND must be demo for demo seeding. Received: production'
    );
  });

  it('requires demo-prefixed tenant ids', async () => {
    const module = await importSafetyModule({ CURAFLOW_DEMO_TENANT_ID: 'tenant-main' });

    expect(() => module.assertSafeDemoEnvironment()).toThrow(
      'CURAFLOW_DEMO_TENANT_ID must start with "demo-". Received: tenant-main'
    );
  });

  it('requires all demo user passwords', async () => {
    const module = await importSafetyModule({ CURAFLOW_DEMO_RESET_PASSWORD: '' });

    expect(() => module.getDemoUserPasswords()).toThrow(
      'CURAFLOW_DEMO_RESET_PASSWORD is required for demo seeding'
    );
  });

  it('requires sufficiently long demo passwords', async () => {
    const module = await importSafetyModule({ CURAFLOW_DEMO_ADMIN_PASSWORD: 'short' });

    expect(() => module.getDemoUserPasswords()).toThrow(
      'CURAFLOW_DEMO_ADMIN_PASSWORD must be at least 12 characters long for demo seeding'
    );
  });
});
