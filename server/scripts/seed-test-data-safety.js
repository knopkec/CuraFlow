const LOCAL_TEST_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', 'mysql']);

export function assertSafeIdentifier(value, label) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`${label} contains unsupported characters: ${value}`);
  }
}

export function assertSafeHost(value, label) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  if (!LOCAL_TEST_HOSTS.has(normalizedValue)) {
    throw new Error(`${label} must be local for test seeding. Received: ${value}`);
  }
}

export function assertSafeTestEnvironment(env = process.env) {
  const masterDbName = env.MYSQL_DATABASE || 'curaflow_test_master';
  const tenantDbName = env.TEST_TENANT_DATABASE || 'curaflow_test_tenant';
  const mysqlHost = env.MYSQL_HOST || '127.0.0.1';

  if (env.NODE_ENV !== 'test') {
    throw new Error('seed-test-data.js may only run with NODE_ENV=test');
  }

  if (env.CONFIRM_SEED_TEST_DATA !== '1') {
    throw new Error('CONFIRM_SEED_TEST_DATA=1 is required to run seed-test-data.js');
  }

  const requiredTestPatterns = [
    { label: 'MYSQL_DATABASE', value: masterDbName },
    { label: 'TEST_TENANT_DATABASE', value: tenantDbName },
  ];

  for (const entry of requiredTestPatterns) {
    if (!/test/i.test(entry.value)) {
      throw new Error(`${entry.label} must clearly target a test database. Received: ${entry.value}`);
    }
  }

  assertSafeHost(mysqlHost, 'MYSQL_HOST');
}
