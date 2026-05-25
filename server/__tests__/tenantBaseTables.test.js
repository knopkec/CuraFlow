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
});
