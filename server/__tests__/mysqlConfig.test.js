import { describe, expect, it } from 'vitest';

import {
  parseMysqlConnectionString,
  resolveMasterDbConfig,
  resolveTenantDbConfig,
} from '../utils/mysqlConfig.js';

describe('parseMysqlConnectionString', () => {
  it('parses CaddyTower-style tcp DSNs', () => {
    expect(parseMysqlConnectionString('demo:secret@tcp(caddytower-mariadb:3306)/curaflow_demo?parseTime=true')).toEqual(
      expect.objectContaining({
        host: 'caddytower-mariadb',
        port: 3306,
        user: 'demo',
        password: 'secret',
        database: 'curaflow_demo',
      })
    );
  });

  it('parses mysql urls', () => {
    expect(parseMysqlConnectionString('mysql://demo:secret@mysql.internal:3307/curaflow_demo')).toEqual(
      expect.objectContaining({
        host: 'mysql.internal',
        port: 3307,
        user: 'demo',
        password: 'secret',
        database: 'curaflow_demo',
      })
    );
  });
});

describe('resolveMasterDbConfig', () => {
  it('prefers CURAFLOW_MASTER_MYSQL_URL over discrete MYSQL vars', () => {
    const env = {
      CURAFLOW_MASTER_MYSQL_URL: 'master:secret@tcp(master-db:3306)/curaflow_master?parseTime=true',
      MYSQL_HOST: 'ignored-host',
      MYSQL_USER: 'ignored-user',
      MYSQL_PASSWORD: 'ignored-password',
      MYSQL_DATABASE: 'ignored-db',
    };

    expect(resolveMasterDbConfig(env)).toEqual(expect.objectContaining({
      host: 'master-db',
      user: 'master',
      password: 'secret',
      database: 'curaflow_master',
    }));
  });

  it('falls back to discrete MYSQL vars', () => {
    const env = {
      MYSQL_HOST: 'localhost',
      MYSQL_PORT: '3310',
      MYSQL_USER: 'curaflow',
      MYSQL_PASSWORD: 'pw',
      MYSQL_DATABASE: 'curaflow_demo_master',
    };

    expect(resolveMasterDbConfig(env)).toEqual(expect.objectContaining({
      host: 'localhost',
      port: 3310,
      user: 'curaflow',
      password: 'pw',
      database: 'curaflow_demo_master',
    }));
  });
});

describe('resolveTenantDbConfig', () => {
  it('uses CURAFLOW_TENANT_MYSQL_URL when present', () => {
    const env = {
      CURAFLOW_TENANT_MYSQL_URL: 'tenant:secret@tcp(tenant-db:3306)/curaflow_demo_tenant?parseTime=true',
    };

    expect(resolveTenantDbConfig(env)).toEqual(expect.objectContaining({
      host: 'tenant-db',
      user: 'tenant',
      database: 'curaflow_demo_tenant',
    }));
  });

  it('falls back to dedicated tenant discrete vars', () => {
    const env = {
      TEST_TENANT_MYSQL_HOST: 'tenant-host',
      TEST_TENANT_MYSQL_PORT: '3308',
      TEST_TENANT_MYSQL_USER: 'tenant-user',
      TEST_TENANT_MYSQL_PASSWORD: 'tenant-password',
      CURAFLOW_TENANT_DATABASE: 'tenant_db',
    };

    expect(resolveTenantDbConfig(env)).toEqual(expect.objectContaining({
      host: 'tenant-host',
      port: 3308,
      user: 'tenant-user',
      password: 'tenant-password',
      database: 'tenant_db',
    }));
  });

  it('can reuse master connection details with a separate tenant database name', () => {
    const masterConfig = resolveMasterDbConfig({
      MYSQL_HOST: 'master-host',
      MYSQL_USER: 'shared-user',
      MYSQL_PASSWORD: 'shared-password',
      MYSQL_DATABASE: 'master_db',
    });

    expect(resolveTenantDbConfig({ CURAFLOW_TENANT_DATABASE: 'tenant_db' }, masterConfig)).toEqual(expect.objectContaining({
      host: 'master-host',
      user: 'shared-user',
      password: 'shared-password',
      database: 'tenant_db',
    }));
  });
});
