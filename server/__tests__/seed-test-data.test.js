import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function importSeedModule(envOverrides) {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    MYSQL_DATABASE: 'curaflow_test_master',
    TEST_TENANT_DATABASE: 'curaflow_test_tenant',
    MYSQL_HOST: '127.0.0.1',
    CONFIRM_SEED_TEST_DATA: '1',
    SEED_ADMIN_PASSWORD: 'admin-secret',
    SEED_USER_PASSWORD: 'user-secret',
    SEED_READONLY_PASSWORD: 'readonly-secret',
    ...envOverrides,
  };

  vi.resetModules();
  return import('../scripts/seed-test-data-safety.js');
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('seed-test-data safety guards', () => {
  it('accepts local test database targets', async () => {
    const module = await importSeedModule();

    expect(() => module.assertSafeTestEnvironment()).not.toThrow();
  });

  it('rejects non-local database hosts', async () => {
    const module = await importSeedModule({ MYSQL_HOST: 'prod-db.internal' });

    expect(() => module.assertSafeTestEnvironment()).toThrow(
      'MYSQL_HOST must be local for test seeding. Received: prod-db.internal'
    );
  });

  it('rejects non-test database names', async () => {
    const module = await importSeedModule({ MYSQL_DATABASE: 'curaflow_master' });

    expect(() => module.assertSafeTestEnvironment()).toThrow(
      'MYSQL_DATABASE must clearly target a test database. Received: curaflow_master'
    );
  });
});
