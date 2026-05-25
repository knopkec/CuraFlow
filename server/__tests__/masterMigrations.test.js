import { describe, expect, it } from 'vitest';
import { runMasterMigrations } from '../utils/masterMigrations.js';

function createMockDbPool() {
  const calls = [];

  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('FROM information_schema.COLUMNS')) {
        if (sql.includes('COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME')) {
          if (params[0] === 'db_tokens' && params[1] === 'id') {
            return [[{
              COLUMN_TYPE: 'VARCHAR(64)',
              CHARACTER_SET_NAME: 'utf8mb4',
              COLLATION_NAME: 'utf8mb4_0900_ai_ci',
            }]];
          }
          if (params[0] === 'shared_shift_entry' && params[1] === 'billing_tenant_id') {
            return [[{
              COLUMN_TYPE: 'VARCHAR(36)',
              CHARACTER_SET_NAME: 'utf8mb4',
              COLLATION_NAME: 'utf8mb4_unicode_ci',
            }]];
          }
          return [[null]];
        }
        return [[{ cnt: 0 }]];
      }

      return [[], []];
    },
  };
}

describe('runMasterMigrations', () => {
  it('checks app_users.wish_default_position before altering the app_users table', async () => {
    const dbPool = createMockDbPool();

    await runMasterMigrations(dbPool);

    const appUsersCalls = dbPool.calls.filter(
      ({ sql, params }) =>
        sql.includes('ALTER TABLE `app_users` ADD COLUMN `wish_default_position`') ||
        (sql.includes('FROM information_schema.COLUMNS') && params[0] === 'app_users' && params[1] === 'wish_default_position')
    );

    expect(appUsersCalls).toEqual([
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['app_users', 'wish_default_position'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ALTER TABLE `app_users` ADD COLUMN `wish_default_position` VARCHAR(255) DEFAULT NULL'),
      }),
    ]);
  });

  it('checks Employee.work_time_model_id before altering the Employee table', async () => {
    const dbPool = createMockDbPool();

    await runMasterMigrations(dbPool);

    const employeeCalls = dbPool.calls.filter(
      ({ sql, params }) =>
        sql.includes('ALTER TABLE `Employee` ADD COLUMN `work_time_model_id`') ||
        (sql.includes('FROM information_schema.COLUMNS') && params[0] === 'Employee')
    );

    expect(employeeCalls).toEqual([
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['Employee', 'work_time_model_id'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ALTER TABLE `Employee` ADD COLUMN `work_time_model_id` VARCHAR(36) DEFAULT NULL'),
      }),
    ]);
  });

  it('adds QualificationCertificate analysis columns sequentially', async () => {
    const dbPool = createMockDbPool();

    await runMasterMigrations(dbPool);

    const qualificationCertificateCalls = dbPool.calls.filter(
      ({ sql, params }) =>
        sql.includes('QualificationCertificate') ||
        (sql.includes('FROM information_schema.COLUMNS') && params[0] === 'QualificationCertificate')
    );

    expect(qualificationCertificateCalls).toEqual([
      expect.objectContaining({
        sql: expect.stringContaining('CREATE TABLE IF NOT EXISTS QualificationCertificate'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'evidence_role'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `evidence_role`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_status'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_status`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_is_certificate'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_is_certificate`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_scope_match'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_scope_match`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_scope_detected'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_scope_detected`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_confidence'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_confidence`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_reasoning'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_reasoning`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_detected_granted'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_detected_granted`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analysis_detected_expiry'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analysis_detected_expiry`'),
      }),
      expect.objectContaining({
        sql: expect.stringContaining('FROM information_schema.COLUMNS'),
        params: ['QualificationCertificate', 'analyzed_at'],
      }),
      expect.objectContaining({
        sql: expect.stringContaining('ADD COLUMN `analyzed_at`'),
      }),
    ]);
  });

  it('creates the tenant_group tables and adds group columns to app_users', async () => {
    const dbPool = createMockDbPool();

    await runMasterMigrations(dbPool);

    const createdTables = dbPool.calls.filter(({ sql }) =>
      sql.includes('CREATE TABLE IF NOT EXISTS tenant_group ')
      || sql.includes('CREATE TABLE IF NOT EXISTS tenant_group_member ')
      || sql.includes('CREATE TABLE IF NOT EXISTS shared_workplace ')
      || sql.includes('CREATE TABLE IF NOT EXISTS shared_shift_entry ')
      || sql.includes('CREATE TABLE IF NOT EXISTS shared_workplace_quota ')
    );
    expect(createdTables).toHaveLength(5);

    const allowedGroupsAlter = dbPool.calls.find(({ sql }) =>
      sql.includes('ALTER TABLE `app_users` ADD COLUMN `allowed_groups`')
    );
    expect(allowedGroupsAlter).toBeDefined();

    const adminGroupsAlter = dbPool.calls.find(({ sql }) =>
      sql.includes('ALTER TABLE `app_users` ADD COLUMN `group_admin_groups`')
    );
    expect(adminGroupsAlter).toBeDefined();
  });

  it('aligns shared_shift_entry.billing_tenant_id to db_tokens.id metadata', async () => {
    const dbPool = createMockDbPool();

    await runMasterMigrations(dbPool);

    const metadataReads = dbPool.calls.filter(
      ({ sql, params }) =>
        sql.includes('COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME')
        && (
          (params[0] === 'db_tokens' && params[1] === 'id')
          || (params[0] === 'shared_shift_entry' && params[1] === 'billing_tenant_id')
        )
    );
    expect(metadataReads).toHaveLength(2);

    const modifyCall = dbPool.calls.find(({ sql }) =>
      sql.includes('ALTER TABLE `shared_shift_entry` MODIFY COLUMN `billing_tenant_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL')
    );
    expect(modifyCall).toBeDefined();
  });
});