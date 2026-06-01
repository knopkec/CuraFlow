import { describe, expect, it } from 'vitest';
import { runTenantMigrations } from '../utils/tenantMigrations.js';

describe('runTenantMigrations', () => {
  it('aborts immediately on fatal pool errors instead of continuing with a closed pool', async () => {
    const fatalError = new Error('Pool is closed.');
    const tenantPool = {
      execute: async () => {
        throw fatalError;
      },
    };

    await expect(runTenantMigrations(tenantPool, 'tenant-token')).rejects.toThrow('Pool is closed.');
  });
});