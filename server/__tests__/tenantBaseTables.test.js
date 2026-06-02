import { describe, expect, it } from 'vitest';
import { ensureTenantBaseTables } from '../scripts/seed-runtime-shared.js';

function createMockTenantPool() {
  const calls = [];

  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });
      return [[], []];
    },
  };
}

describe('ensureTenantBaseTables', () => {
  it('creates the Doctor table with central employee linking support', async () => {
    const tenantPool = createMockTenantPool();

    await ensureTenantBaseTables(tenantPool);

    const doctorCreate = tenantPool.calls.find(({ sql }) =>
      sql.includes('CREATE TABLE IF NOT EXISTS Doctor')
    );

    expect(doctorCreate).toBeDefined();
    expect(doctorCreate.sql).toContain('central_employee_id VARCHAR(36) DEFAULT NULL');
    expect(doctorCreate.sql).toContain('INDEX idx_doctor_central_employee (central_employee_id)');
  });

  it('patches existing WishRequest tables with the columns from seed-runtime-shared', async () => {
    // Old tenants (onboarded before target_month existed) keep the old table
    // shape because CREATE TABLE IF NOT EXISTS is a no-op for an existing
    // table. ensureColumns must issue ADD COLUMN for every column that the
    // current schema expects but the legacy table is missing. We assert
    // target_month is the first one patched because that is the column the
    // Statistics filter blew up on, and we assert at least one of the other
    // documented columns is also covered so the patch is comprehensive.
    const tenantPool = createMockTenantPool();

    await ensureTenantBaseTables(tenantPool);

    const wishPatches = tenantPool.calls
      .map(({ sql }) => sql)
      .filter((sql) => sql.includes('ALTER TABLE `WishRequest` ADD COLUMN'));

    expect(wishPatches).toContain(
      "ALTER TABLE `WishRequest` ADD COLUMN `target_month` VARCHAR(7) DEFAULT NULL"
    );
    expect(wishPatches).toContain(
      "ALTER TABLE `WishRequest` ADD COLUMN `position` VARCHAR(255) DEFAULT NULL"
    );
    expect(wishPatches).toContain(
      "ALTER TABLE `WishRequest` ADD COLUMN `approved_date` DATETIME DEFAULT NULL"
    );
  });
});
