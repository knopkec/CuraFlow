import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { encryptToken } from '../utils/crypto.js';
import { runMasterMigrations } from '../utils/masterMigrations.js';
import { runTenantMigrations } from '../utils/tenantMigrations.js';
import { resolveMasterDbConfig, resolveTenantDbConfig } from '../utils/mysqlConfig.js';
import { buildDemoSeedData, DEMO_PREFIX } from './demo-seed-data.js';
import { assertSafeDemoEnvironment, getDemoUserPasswords } from './seed-demo-data-safety.js';
import { ensureMasterBaseTables, ensureTenantBaseTables } from './seed-runtime-shared.js';

const DEMO_TENANT_ID = process.env.CURAFLOW_DEMO_TENANT_ID || 'demo-tenant-main';
const DEMO_TENANT_NAME = process.env.CURAFLOW_DEMO_TENANT_NAME || 'CuraFlow Demo Tenant';
const DEMO_ADMIN_EMAIL = process.env.CURAFLOW_DEMO_ADMIN_EMAIL || 'demo-admin@curaflow.local';
const DEMO_USER_EMAIL = process.env.CURAFLOW_DEMO_USER_EMAIL || 'demo-user@curaflow.local';
const DEMO_READONLY_EMAIL = process.env.CURAFLOW_DEMO_READONLY_EMAIL || 'demo-readonly@curaflow.local';
const DEMO_RESET_EMAIL = process.env.CURAFLOW_DEMO_RESET_EMAIL || 'demo-reset@curaflow.local';
const DEMO_INACTIVE_EMAIL = process.env.CURAFLOW_DEMO_INACTIVE_EMAIL || 'demo-inactive@curaflow.local';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPool(config) {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    dateStrings: true,
    timezone: '+00:00',
  });
}

async function waitForPool(label, factory, attempts = 30) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let pool;
    try {
      pool = factory();
      await pool.query('SELECT 1');
      console.log(`[demo-seed] Connected to ${label} (${attempt}/${attempts})`);
      return pool;
    } catch (error) {
      lastError = error;
      await pool?.end().catch(() => {});
      console.warn(`[demo-seed] Waiting for ${label}: ${error.message}`);
      await sleep(2000);
    }
  }

  throw lastError ?? new Error(`Failed to connect to ${label}`);
}

async function deleteDemoRows(pool, tableName, {
  idColumn = 'id',
  pattern = `${DEMO_PREFIX}%`,
} = {}) {
  await pool.execute(`DELETE FROM \`${tableName}\` WHERE \`${idColumn}\` LIKE ?`, [pattern]);
}

async function insertRows(pool, tableName, columns, rows) {
  if (!rows.length) {
    return;
  }

  const placeholders = columns.map(() => '?').join(', ');
  const sql = `
    INSERT INTO \`${tableName}\` (${columns.map((column) => `\`${column}\``).join(', ')})
    VALUES (${placeholders})
  `;

  for (const row of rows) {
    try {
      await pool.execute(sql, row);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw new Error(`Demo seeding refused to overwrite an existing ${tableName} row: ${error.message}`);
      }

      throw error;
    }
  }
}

async function resetMasterDemoRows(masterPool) {
  await deleteDemoRows(masterPool, 'db_tokens');
  await deleteDemoRows(masterPool, 'app_users');
}

async function resetTenantDemoRows(tenantPool) {
  const tables = [
    'WorkplaceQualification',
    'DoctorQualification',
    'TrainingRotation',
    'WishRequest',
    'ShiftNotification',
    'ShiftEntry',
    'StaffingPlanEntry',
    'ScheduleBlock',
    'ScheduleNote',
    'CustomHoliday',
    'ColorSetting',
    'DemoSetting',
    'ScheduleRule',
    'SystemLog',
    'VoiceAlias',
    'Qualification',
    'Workplace',
    'Doctor',
    'TeamRole',
    'SystemSetting',
  ];

  for (const table of tables) {
    await deleteDemoRows(tenantPool, table);
  }
}

async function upsertMasterUsers(masterPool, doctorIds) {
  const passwords = getDemoUserPasswords();
  const hashedPasswords = await Promise.all([
    bcrypt.hash(passwords.CURAFLOW_DEMO_ADMIN_PASSWORD, 10),
    bcrypt.hash(passwords.CURAFLOW_DEMO_USER_PASSWORD, 10),
    bcrypt.hash(passwords.CURAFLOW_DEMO_READONLY_PASSWORD, 10),
    bcrypt.hash(passwords.CURAFLOW_DEMO_RESET_PASSWORD, 10),
    bcrypt.hash(passwords.CURAFLOW_DEMO_RESET_PASSWORD, 10),
  ]);

  await insertRows(
    masterPool,
    'app_users',
    ['id', 'email', 'password_hash', 'full_name', 'role', 'doctor_id', 'is_active', 'allowed_tenants', 'must_change_password', 'email_verified'],
    [
      [`${DEMO_PREFIX}user-admin`, DEMO_ADMIN_EMAIL, hashedPasswords[0], 'Demo Admin', 'admin', doctorIds.anna, 1, JSON.stringify([DEMO_TENANT_ID]), 0, 1],
      [`${DEMO_PREFIX}user-standard`, DEMO_USER_EMAIL, hashedPasswords[1], 'Demo User', 'user', doctorIds.clara, 1, JSON.stringify([DEMO_TENANT_ID]), 0, 1],
      [`${DEMO_PREFIX}user-readonly`, DEMO_READONLY_EMAIL, hashedPasswords[2], 'Demo Readonly', 'readonly', doctorIds.emma, 1, JSON.stringify([DEMO_TENANT_ID]), 0, 1],
      [`${DEMO_PREFIX}user-reset`, DEMO_RESET_EMAIL, hashedPasswords[3], 'Demo Reset User', 'user', doctorIds.felix, 1, JSON.stringify([DEMO_TENANT_ID]), 1, 1],
      [`${DEMO_PREFIX}user-inactive`, DEMO_INACTIVE_EMAIL, hashedPasswords[4], 'Demo Inactive User', 'user', doctorIds.irene, 0, JSON.stringify([DEMO_TENANT_ID]), 0, 1],
    ]
  );
}

async function upsertDbToken(masterPool, tenantConfig) {
  const encryptedToken = encryptToken(
    JSON.stringify({
      host: tenantConfig.host,
      port: tenantConfig.port,
      user: tenantConfig.user,
      password: tenantConfig.password,
      database: tenantConfig.database,
    })
  );

  await insertRows(
    masterPool,
    'db_tokens',
    ['id', 'name', 'token', 'host', 'db_name', 'description', 'is_active', 'created_by'],
    [[
      DEMO_TENANT_ID,
      DEMO_TENANT_NAME,
      encryptedToken,
      tenantConfig.host,
      tenantConfig.database,
      'Rolling demo tenant managed by seed-demo-data.js',
      1,
      'demo-seed',
    ]]
  );
}

async function seedTenantData(tenantPool, demoData) {
  await insertRows(
    tenantPool,
    'TeamRole',
    ['id', 'name', 'priority', 'is_specialist', 'can_do_foreground_duty', 'can_do_background_duty', 'excluded_from_statistics', 'description'],
    demoData.teamRoles
  );

  await insertRows(
    tenantPool,
    'Doctor',
    ['id', 'name', 'initials', 'role', 'email', 'google_email', 'order', 'is_active', 'exclude_from_staffing_plan', 'receive_email_notifications', 'target_weekly_hours'],
    demoData.doctors
  );

  await insertRows(
    tenantPool,
    'Workplace',
    ['id', 'name', 'category', 'order', 'is_active', 'allows_multiple', 'service_type', 'min_staff', 'optimal_staff'],
    demoData.workplaces
  );

  await insertRows(
    tenantPool,
    'Qualification',
    ['id', 'name', 'short_label', 'description', 'category', 'order', 'requires_certificate', 'certificate_validity_months'],
    demoData.qualifications
  );

  await insertRows(
    tenantPool,
    'DoctorQualification',
    ['id', 'doctor_id', 'qualification_id', 'granted_date', 'expiry_date'],
    demoData.doctorQualifications
  );

  await insertRows(
    tenantPool,
    'WorkplaceQualification',
    ['id', 'workplace_id', 'qualification_id', 'is_mandatory', 'is_excluded'],
    demoData.workplaceQualifications
  );

  await insertRows(
    tenantPool,
    'ShiftEntry',
    ['id', 'date', 'doctor_id', 'position', 'order'],
    demoData.shiftEntries
  );

  await insertRows(
    tenantPool,
    'WishRequest',
    ['id', 'doctor_id', 'target_month', 'start_date', 'end_date', 'position', 'type', 'status', 'comment'],
    demoData.wishRequests
  );

  await insertRows(
    tenantPool,
    'TrainingRotation',
    ['id', 'doctor_id', 'title', 'workplace_id', 'start_date', 'end_date', 'status', 'notes'],
    demoData.trainingRotations
  );

  await insertRows(
    tenantPool,
    'StaffingPlanEntry',
    ['id', 'doctor_id', 'year', 'month', 'value'],
    demoData.staffingPlanEntries
  );

  await insertRows(
    tenantPool,
    'CustomHoliday',
    ['id', 'name', 'date', 'state_code'],
    demoData.customHolidays
  );

  await insertRows(
    tenantPool,
    'SystemSetting',
    ['id', 'key', 'value'],
    demoData.systemSettings
  );

  await insertRows(
    tenantPool,
    'ColorSetting',
    ['id', 'name', 'category', 'bg_color', 'text_color'],
    demoData.colorSettings
  );

  await insertRows(
    tenantPool,
    'ScheduleNote',
    ['id', 'date', 'note'],
    demoData.scheduleNotes
  );

  await insertRows(
    tenantPool,
    'ScheduleRule',
    ['id', 'name', 'rule_type', 'rule_config', 'is_active'],
    demoData.scheduleRules
  );

  await insertRows(
    tenantPool,
    'ScheduleBlock',
    ['id', 'date', 'position', 'timeslot_id', 'reason'],
    demoData.scheduleBlocks
  );

  await insertRows(
    tenantPool,
    'DemoSetting',
    ['id', 'key', 'value'],
    demoData.demoSettings
  );

  await insertRows(
    tenantPool,
    'VoiceAlias',
    ['id', 'alias', 'target_name'],
    demoData.voiceAliases
  );

  await insertRows(
    tenantPool,
    'SystemLog',
    ['id', 'level', 'source', 'message', 'details'],
    demoData.systemLogs
  );
}

async function main() {
  assertSafeDemoEnvironment();

  const masterConfig = resolveMasterDbConfig();
  const tenantConfig = resolveTenantDbConfig(process.env, masterConfig);
  const masterPool = await waitForPool('master demo database', () => createPool(masterConfig));
  const tenantPool = await waitForPool('tenant demo database', () => createPool(tenantConfig));
  const demoData = buildDemoSeedData(new Date());

  try {
    await ensureMasterBaseTables(masterPool);
    await runMasterMigrations(masterPool);
    await ensureTenantBaseTables(tenantPool);
    await runTenantMigrations(tenantPool, DEMO_TENANT_ID);

    await resetMasterDemoRows(masterPool);
    await resetTenantDemoRows(tenantPool);
    await seedTenantData(tenantPool, demoData);

    const doctorIds = {
      anna: `${DEMO_PREFIX}doctor-anna`,
      clara: `${DEMO_PREFIX}doctor-clara`,
      emma: `${DEMO_PREFIX}doctor-emma`,
      felix: `${DEMO_PREFIX}doctor-felix`,
      irene: `${DEMO_PREFIX}doctor-irene`,
    };

    await upsertMasterUsers(masterPool, doctorIds);
    await upsertDbToken(masterPool, tenantConfig);

    console.log(`[demo-seed] Seeded rolling demo data for ${demoData.metadata.currentMonth}`);
  } finally {
    await Promise.allSettled([tenantPool.end(), masterPool.end()]);
  }
}

main().catch((error) => {
  console.error('[demo-seed] Failed to seed rolling demo data:', error);
  process.exitCode = 1;
});
