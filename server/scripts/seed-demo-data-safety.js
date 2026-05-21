import { resolveMasterDbConfig, resolveTenantDbConfig } from '../utils/mysqlConfig.js';

const MIN_DEMO_PASSWORD_LENGTH = 12;

export function assertSafeDemoEnvironment(env = process.env) {
  if (env.CURAFLOW_DEMO_SEED !== '1') {
    throw new Error('CURAFLOW_DEMO_SEED=1 is required for demo seeding');
  }

  if ((env.CURAFLOW_INSTANCE_KIND || '').trim().toLowerCase() !== 'demo') {
    throw new Error(`CURAFLOW_INSTANCE_KIND must be demo for demo seeding. Received: ${env.CURAFLOW_INSTANCE_KIND || '(empty)'}`);
  }

  const tenantId = (env.CURAFLOW_DEMO_TENANT_ID || '').trim();
  if (!tenantId.startsWith('demo-')) {
    throw new Error(`CURAFLOW_DEMO_TENANT_ID must start with "demo-". Received: ${tenantId || '(empty)'}`);
  }

  const tenantName = (env.CURAFLOW_DEMO_TENANT_NAME || '').trim();
  if (!tenantName) {
    throw new Error('CURAFLOW_DEMO_TENANT_NAME is required for demo seeding');
  }

  const masterConfig = resolveMasterDbConfig(env);
  const tenantConfig = resolveTenantDbConfig(env, masterConfig);

  if (!tenantConfig) {
    throw new Error('Demo seeding requires tenant DB configuration via CURAFLOW_TENANT_MYSQL_URL or CURAFLOW_TENANT_DATABASE');
  }

  if (masterConfig.database === tenantConfig.database) {
    throw new Error('Demo seeding requires separate master and tenant databases');
  }
}

export function getDemoUserPasswords(env = process.env) {
  const requiredNames = [
    'CURAFLOW_DEMO_ADMIN_PASSWORD',
    'CURAFLOW_DEMO_USER_PASSWORD',
    'CURAFLOW_DEMO_READONLY_PASSWORD',
    'CURAFLOW_DEMO_RESET_PASSWORD',
  ];

  return requiredNames.reduce((accumulator, name) => {
    const value = env[name];
    if (!value) {
      throw new Error(`${name} is required for demo seeding`);
    }

    if (value.length < MIN_DEMO_PASSWORD_LENGTH) {
      throw new Error(`${name} must be at least ${MIN_DEMO_PASSWORD_LENGTH} characters long for demo seeding`);
    }

    accumulator[name] = value;
    return accumulator;
  }, {});
}
