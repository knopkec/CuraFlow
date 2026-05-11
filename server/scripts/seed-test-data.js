import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { encryptToken } from '../utils/crypto.js';
import { runMasterMigrations } from '../utils/masterMigrations.js';
import { runTenantMigrations } from '../utils/tenantMigrations.js';

const MASTER_DB_NAME = process.env.MYSQL_DATABASE || 'curaflow_test_master';
const TENANT_DB_NAME = process.env.TEST_TENANT_DATABASE || 'curaflow_test_tenant';
const TENANT_ID = process.env.TEST_TENANT_ID || 'tenant-main';
const TENANT_NAME = process.env.TEST_TENANT_NAME || 'CuraFlow Test Tenant';
const TARGET_MONTH = process.env.TEST_TARGET_MONTH || '2026-05';
const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const MYSQL_PORT = Number(process.env.MYSQL_PORT || '3306');
const MYSQL_USER = process.env.MYSQL_USER || 'curaflow';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_ROOT_PASSWORD = process.env.MYSQL_ROOT_PASSWORD || '';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for seed-test-data.js`);
  }
  return value;
}

const USER_PASSWORDS = {
  admin: requiredEnv('SEED_ADMIN_PASSWORD'),
  user: requiredEnv('SEED_USER_PASSWORD'),
  readonly: requiredEnv('SEED_READONLY_PASSWORD'),
};

const teamRoles = [
  ['role-chief', 'Chefarzt', 0, true, false, true, false, 'Oberste Führungsebene'],
  ['role-senior', 'Oberarzt', 1, true, false, true, false, 'Kann Hintergrunddienste übernehmen'],
  ['role-specialist', 'Facharzt', 2, true, true, true, false, 'Kann alle Dienste übernehmen'],
  ['role-resident', 'Assistenzarzt', 3, false, true, false, false, 'Kann Vordergrunddienste übernehmen'],
  ['role-non-rad', 'Nicht-Radiologe', 4, false, false, false, true, 'Wird in Statistiken nicht gezählt'],
];

const doctors = [
  ['doctor-anna', 'Anna Adler', 'AA', 'Facharzt', 'anna.adler@test.local', 'anna.adler@test.local', 1, true, false, true, 38.5],
  ['doctor-bruno', 'Bruno Berg', 'BB', 'Oberarzt', 'bruno.berg@test.local', 'bruno.berg@test.local', 2, true, false, true, 40.0],
  ['doctor-clara', 'Clara Conrad', 'CC', 'Assistenzarzt', 'clara.conrad@test.local', 'clara.conrad@test.local', 3, true, false, true, 35.0],
  ['doctor-david', 'David Dorn', 'DD', 'Facharzt', 'david.dorn@test.local', 'david.dorn@test.local', 4, true, false, true, 30.0],
  ['doctor-emma', 'Emma Eber', 'EE', 'Nicht-Radiologe', 'emma.eber@test.local', 'emma.eber@test.local', 5, true, true, false, 20.0],
];

const workplaces = [
  ['workplace-foreground', 'Dienst Vordergrund', 'Dienste', 1, true, false, 1, 1, 1],
  ['workplace-background', 'Dienst Hintergrund', 'Dienste', 2, true, false, 2, 1, 1],
  ['workplace-ct', 'CT', 'Dienste', 3, true, false, 2, 1, 2],
  ['workplace-mrt', 'MRT Rotation', 'Rotationen', 4, true, true, null, 1, 1],
  ['workplace-sono', 'Sono Rotation', 'Rotationen', 5, true, true, null, 1, 1],
  ['workplace-demo', 'Demo / Konsil', 'Demonstrationen & Konsile', 6, true, true, null, 1, 1],
];

const qualifications = [
  ['qualification-radiation', 'Strahlenschutz', 'SS', 'Berechtigung für strahlenrelevante Dienste', 'Pflicht', 1, true, 60],
  ['qualification-mri', 'MRT', 'MRT', 'MRT-Fachkunde', 'Fachlich', 2, false, null],
];

const doctorQualifications = [
  ['doctor-qualification-anna-radiation', 'doctor-anna', 'qualification-radiation', '2024-01-01', '2029-01-01'],
  ['doctor-qualification-bruno-radiation', 'doctor-bruno', 'qualification-radiation', '2023-06-01', '2028-06-01'],
  ['doctor-qualification-clara-mri', 'doctor-clara', 'qualification-mri', '2024-09-01', null],
];

const workplaceQualifications = [
  ['workplace-qualification-ct-radiation', 'workplace-ct', 'qualification-radiation', true, false],
  ['workplace-qualification-mrt-mri', 'workplace-mrt', 'qualification-mri', true, false],
];

const shiftEntries = [
  ['shift-2026-05-05-foreground', `${TARGET_MONTH}-05`, 'doctor-anna', 'Dienst Vordergrund', 1],
  ['shift-2026-05-05-background', `${TARGET_MONTH}-05`, 'doctor-bruno', 'Dienst Hintergrund', 2],
  ['shift-2026-05-06-ct', `${TARGET_MONTH}-06`, 'doctor-clara', 'CT', 3],
  ['shift-2026-05-06-mrt', `${TARGET_MONTH}-06`, 'doctor-david', 'MRT Rotation', 4],
];

const wishRequests = [
  ['wish-anna-may', 'doctor-anna', TARGET_MONTH, `${TARGET_MONTH}-12`, `${TARGET_MONTH}-12`, 'Dienst Vordergrund', 'service', 'approved', 'Frühdienst bevorzugt'],
];

const trainingRotations = [
  ['training-clara-mrt', 'doctor-clara', 'MRT Einarbeitung', 'workplace-mrt', `${TARGET_MONTH}-10`, `${TARGET_MONTH}-14`, 'planned', 'Begleitung durch Oberarzt'],
];

const staffingPlanEntries = [
  ['staffing-ct-2026-05-06', 'doctor-clara', 'workplace-ct', `${TARGET_MONTH}-06`, '08:00:00', '16:00:00', 'assigned'],
];

const customHolidays = [
  ['holiday-lab-day', 'Testfeiertag', `${TARGET_MONTH}-01`, 'NW'],
];

const systemSettings = [
  ['system-setting-wish-deadline', 'wish_deadline_months', '2'],
  [
    'system-setting-wish-approval',
    'wish_approval_rules',
    JSON.stringify({
      service_requires_approval: true,
      no_service_requires_approval: true,
      auto_create_shift_on_approval: false,
      exceptions: {},
    }),
  ],
  ['system-setting-wish-reminder', 'wish_reminder_email_enabled', 'true'],
];

const colorSettings = [
  ['color-setting-vacation', 'Urlaub', 'position', '#22c55e', '#ffffff'],
  ['color-setting-services', 'Dienste', 'section', '#dbeafe', '#1e3a8a'],
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPool({ database, user, password }) {
  return mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user,
    password,
    database,
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
      console.log(`[seed] Connected to ${label} (${attempt}/${attempts})`);
      return pool;
    } catch (error) {
      lastError = error;
      await pool?.end().catch(() => {});
      console.warn(`[seed] Waiting for ${label}: ${error.message}`);
      await sleep(2000);
    }
  }

  throw lastError ?? new Error(`Failed to connect to ${label}`);
}

async function executeStatements(pool, statements) {
  for (const statement of statements) {
    await pool.execute(statement);
  }
}

function assertSafeIdentifier(value, label) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`${label} contains unsupported characters: ${value}`);
  }
}

async function ensureMasterBaseTables(masterPool) {
  await executeStatements(masterPool, [
    `CREATE TABLE IF NOT EXISTS app_users (
      id VARCHAR(36) PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) DEFAULT '',
      role ENUM('admin', 'user', 'readonly') NOT NULL DEFAULT 'user',
      doctor_id VARCHAR(36) DEFAULT NULL,
      is_active TINYINT(1) DEFAULT 1,
      allowed_tenants JSON DEFAULT NULL,
      must_change_password TINYINT(1) DEFAULT 0,
      theme VARCHAR(50) DEFAULT 'default',
      section_config JSON DEFAULT NULL,
      collapsed_sections JSON DEFAULT NULL,
      schedule_hidden_rows JSON DEFAULT NULL,
      schedule_show_sidebar TINYINT(1) DEFAULT 1,
      schedule_show_time_account TINYINT(1) DEFAULT 0,
      schedule_initials_only TINYINT(1) DEFAULT 0,
      schedule_sort_doctors_alphabetically TINYINT(1) DEFAULT 0,
      highlight_my_name TINYINT(1) DEFAULT 0,
      grid_font_size VARCHAR(20) DEFAULT 'normal',
      wish_show_occupied TINYINT(1) DEFAULT 1,
      wish_show_absences TINYINT(1) DEFAULT 1,
      wish_hidden_doctors JSON DEFAULT NULL,
      email_verified TINYINT(1) DEFAULT 0,
      email_verified_date DATETIME DEFAULT NULL,
      last_login DATETIME DEFAULT NULL,
      last_seen_at DATETIME DEFAULT NULL,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS db_tokens (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      token TEXT NOT NULL,
      host VARCHAR(255),
      db_name VARCHAR(100),
      description TEXT,
      is_active TINYINT(1) DEFAULT 0,
      created_by VARCHAR(255),
      created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  ]);
}

async function ensureTenantDatabase(rootPool) {
  assertSafeIdentifier(TENANT_DB_NAME, 'TEST_TENANT_DATABASE');
  assertSafeIdentifier(MYSQL_USER, 'MYSQL_USER');

  await rootPool.execute(`CREATE DATABASE IF NOT EXISTS \`${TENANT_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await rootPool.query(`GRANT ALL PRIVILEGES ON \`${TENANT_DB_NAME}\`.* TO '${MYSQL_USER}'@'%'`);
  await rootPool.query('FLUSH PRIVILEGES');
}

async function ensureTenantBaseTables(tenantPool) {
  await executeStatements(tenantPool, [
    `CREATE TABLE IF NOT EXISTS Doctor (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      initials VARCHAR(20) DEFAULT NULL,
      role VARCHAR(100) DEFAULT NULL,
      email VARCHAR(255) DEFAULT NULL,
      google_email VARCHAR(255) DEFAULT NULL,
      phone VARCHAR(50) DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      \`order\` INT DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      exclude_from_staffing_plan TINYINT(1) DEFAULT 0,
      receive_email_notifications TINYINT(1) DEFAULT 1,
      work_time_model_id VARCHAR(36) DEFAULT NULL,
      target_weekly_hours DECIMAL(4,1) DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS Workplace (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      category VARCHAR(100) NOT NULL,
      \`order\` INT DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      allows_multiple TINYINT(1) DEFAULT NULL,
      timeslots_enabled TINYINT(1) DEFAULT 0,
      default_overlap_tolerance_minutes INT DEFAULT 15,
      work_time_percentage DECIMAL(5,2) DEFAULT 100.00,
      service_type INT DEFAULT NULL,
      affects_availability TINYINT(1) DEFAULT 1,
      min_staff INT DEFAULT 1,
      optimal_staff INT DEFAULT 1,
      consecutive_days_mode VARCHAR(20) DEFAULT 'allowed',
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS ShiftEntry (
      id VARCHAR(36) PRIMARY KEY,
      date DATE NOT NULL,
      doctor_id VARCHAR(36) DEFAULT NULL,
      position VARCHAR(255) NOT NULL,
      \`order\` INT DEFAULT 0,
      timeslot_id VARCHAR(255) DEFAULT NULL,
      start_time TIME DEFAULT NULL,
      end_time TIME DEFAULT NULL,
      break_minutes INT DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed',
      INDEX idx_shiftentry_date (date),
      INDEX idx_shiftentry_doctor (doctor_id),
      INDEX idx_shiftentry_position (position)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS WishRequest (
      id VARCHAR(36) PRIMARY KEY,
      doctor_id VARCHAR(36) NOT NULL,
      target_month VARCHAR(7) NOT NULL,
      start_date DATE DEFAULT NULL,
      end_date DATE DEFAULT NULL,
      position VARCHAR(255) DEFAULT NULL,
      type VARCHAR(50) DEFAULT 'service',
      status VARCHAR(32) DEFAULT 'pending',
      comment TEXT DEFAULT NULL,
      approved_by VARCHAR(255) DEFAULT NULL,
      approved_date DATETIME DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS TrainingRotation (
      id VARCHAR(36) PRIMARY KEY,
      doctor_id VARCHAR(36) NOT NULL,
      title VARCHAR(255) NOT NULL,
      workplace_id VARCHAR(36) DEFAULT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status VARCHAR(32) DEFAULT 'planned',
      notes TEXT DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS ScheduleRule (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      rule_type VARCHAR(100) DEFAULT NULL,
      rule_config JSON DEFAULT NULL,
      is_active TINYINT(1) DEFAULT 1,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS ColorSetting (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      category VARCHAR(50) NOT NULL,
      bg_color VARCHAR(20) DEFAULT NULL,
      text_color VARCHAR(20) DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS ScheduleNote (
      id VARCHAR(36) PRIMARY KEY,
      date DATE NOT NULL,
      note TEXT DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS SystemSetting (
      id VARCHAR(36) PRIMARY KEY,
      \`key\` VARCHAR(100) NOT NULL UNIQUE,
      \`value\` TEXT DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS CustomHoliday (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      date DATE NOT NULL,
      state_code VARCHAR(10) DEFAULT 'NW',
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS StaffingPlanEntry (
      id VARCHAR(36) PRIMARY KEY,
      doctor_id VARCHAR(36) DEFAULT NULL,
      workplace_id VARCHAR(36) DEFAULT NULL,
      date DATE NOT NULL,
      start_time TIME DEFAULT NULL,
      end_time TIME DEFAULT NULL,
      status VARCHAR(32) DEFAULT 'planned',
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS ShiftNotification (
      id VARCHAR(36) PRIMARY KEY,
      shift_entry_id VARCHAR(36) DEFAULT NULL,
      doctor_id VARCHAR(36) DEFAULT NULL,
      type VARCHAR(50) DEFAULT NULL,
      status VARCHAR(32) DEFAULT 'pending',
      sent_at DATETIME DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS DemoSetting (
      id VARCHAR(36) PRIMARY KEY,
      \`key\` VARCHAR(100) NOT NULL UNIQUE,
      \`value\` TEXT DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS BackupLog (
      id VARCHAR(36) PRIMARY KEY,
      status VARCHAR(32) DEFAULT NULL,
      message TEXT DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS SystemLog (
      id VARCHAR(36) PRIMARY KEY,
      level VARCHAR(20) DEFAULT NULL,
      source VARCHAR(100) DEFAULT NULL,
      message TEXT DEFAULT NULL,
      context JSON DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS VoiceAlias (
      id VARCHAR(36) PRIMARY KEY,
      alias VARCHAR(255) NOT NULL,
      target_name VARCHAR(255) NOT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS TeamRole (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      priority INT NOT NULL DEFAULT 99,
      is_specialist TINYINT(1) NOT NULL DEFAULT 0,
      can_do_foreground_duty TINYINT(1) NOT NULL DEFAULT 1,
      can_do_background_duty TINYINT(1) NOT NULL DEFAULT 0,
      excluded_from_statistics TINYINT(1) NOT NULL DEFAULT 0,
      description VARCHAR(255) DEFAULT NULL,
      created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS Qualification (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      short_label VARCHAR(10) DEFAULT NULL,
      description VARCHAR(255) DEFAULT NULL,
      color_bg VARCHAR(20) DEFAULT '#e0e7ff',
      color_text VARCHAR(20) DEFAULT '#3730a3',
      category VARCHAR(50) DEFAULT 'Allgemein',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      requires_certificate TINYINT(1) NOT NULL DEFAULT 0,
      certificate_requirement_mode VARCHAR(32) DEFAULT 'single_document',
      certificate_validity_months INT DEFAULT NULL,
      certificate_refresh_validity_months INT DEFAULT NULL,
      certificate_base_label VARCHAR(100) DEFAULT 'Grundnachweis',
      certificate_refresh_label VARCHAR(100) DEFAULT 'Verlängerung / Auffrischung',
      \`order\` INT NOT NULL DEFAULT 99,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS DoctorQualification (
      id VARCHAR(255) PRIMARY KEY,
      doctor_id VARCHAR(255) NOT NULL,
      qualification_id VARCHAR(255) NOT NULL,
      granted_date DATE DEFAULT NULL,
      expiry_date DATE DEFAULT NULL,
      notes VARCHAR(255) DEFAULT NULL,
      certificate_status VARCHAR(32) DEFAULT NULL,
      certificate_valid_from DATE DEFAULT NULL,
      certificate_valid_until DATE DEFAULT NULL,
      certificate_status_reason VARCHAR(500) DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed',
      UNIQUE KEY uq_doctor_qual (doctor_id, qualification_id),
      INDEX idx_dq_doctor (doctor_id),
      INDEX idx_dq_qualification (qualification_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS WorkplaceQualification (
      id VARCHAR(255) PRIMARY KEY,
      workplace_id VARCHAR(255) NOT NULL,
      qualification_id VARCHAR(255) NOT NULL,
      is_mandatory TINYINT(1) NOT NULL DEFAULT 1,
      is_excluded TINYINT(1) NOT NULL DEFAULT 0,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed',
      UNIQUE KEY uq_workplace_qual (workplace_id, qualification_id),
      INDEX idx_wq_workplace (workplace_id),
      INDEX idx_wq_qualification (qualification_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS ScheduleBlock (
      id VARCHAR(36) PRIMARY KEY,
      date DATE NOT NULL,
      position VARCHAR(255) NOT NULL,
      timeslot_id VARCHAR(36) DEFAULT NULL,
      reason VARCHAR(500) DEFAULT NULL,
      created_by VARCHAR(255) DEFAULT NULL,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_block (date, position, timeslot_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  ]);
}

async function upsertRows(pool, tableName, columns, rows) {
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns
    .filter((column) => column !== 'id')
    .map((column) => `\`${column}\` = VALUES(\`${column}\`)`)
    .join(', ');

  const sql = `
    INSERT INTO \`${tableName}\` (${columns.map((column) => `\`${column}\``).join(', ')})
    VALUES (${placeholders})
    ON DUPLICATE KEY UPDATE ${updates}
  `;

  for (const row of rows) {
    await pool.execute(sql, row);
  }
}

async function upsertMasterUsers(masterPool) {
  const users = [
    ['user-admin', 'admin@test.local', await bcrypt.hash(USER_PASSWORDS.admin, 10), 'Test Admin', 'admin', 'doctor-anna', 1, JSON.stringify([TENANT_ID]), 0, 1],
    ['user-standard', 'user@test.local', await bcrypt.hash(USER_PASSWORDS.user, 10), 'Test User', 'user', 'doctor-clara', 1, JSON.stringify([TENANT_ID]), 0, 1],
    ['user-readonly', 'readonly@test.local', await bcrypt.hash(USER_PASSWORDS.readonly, 10), 'Test Readonly', 'readonly', 'doctor-emma', 1, JSON.stringify([TENANT_ID]), 1, 1],
  ];

  await upsertRows(
    masterPool,
    'app_users',
    ['id', 'email', 'password_hash', 'full_name', 'role', 'doctor_id', 'is_active', 'allowed_tenants', 'must_change_password', 'email_verified'],
    users
  );
}

async function upsertDbToken(masterPool) {
  const encryptedToken = encryptToken(
    JSON.stringify({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: TENANT_DB_NAME,
    })
  );

  await masterPool.execute('UPDATE db_tokens SET is_active = 0');
  await upsertRows(
    masterPool,
    'db_tokens',
    ['id', 'name', 'token', 'host', 'db_name', 'description', 'is_active', 'created_by'],
    [[TENANT_ID, TENANT_NAME, encryptedToken, MYSQL_HOST, TENANT_DB_NAME, 'Seeded deterministic tenant for UI tests', 1, 'seed-script']]
  );
}

async function seedTenantData(tenantPool) {
  await upsertRows(
    tenantPool,
    'TeamRole',
    ['id', 'name', 'priority', 'is_specialist', 'can_do_foreground_duty', 'can_do_background_duty', 'excluded_from_statistics', 'description'],
    teamRoles
  );

  await upsertRows(
    tenantPool,
    'Doctor',
    ['id', 'name', 'initials', 'role', 'email', 'google_email', 'order', 'is_active', 'exclude_from_staffing_plan', 'receive_email_notifications', 'target_weekly_hours'],
    doctors
  );

  await upsertRows(
    tenantPool,
    'Workplace',
    ['id', 'name', 'category', 'order', 'is_active', 'allows_multiple', 'service_type', 'min_staff', 'optimal_staff'],
    workplaces
  );

  await upsertRows(
    tenantPool,
    'Qualification',
    ['id', 'name', 'short_label', 'description', 'category', 'order', 'requires_certificate', 'certificate_validity_months'],
    qualifications
  );

  await upsertRows(
    tenantPool,
    'DoctorQualification',
    ['id', 'doctor_id', 'qualification_id', 'granted_date', 'expiry_date'],
    doctorQualifications
  );

  await upsertRows(
    tenantPool,
    'WorkplaceQualification',
    ['id', 'workplace_id', 'qualification_id', 'is_mandatory', 'is_excluded'],
    workplaceQualifications
  );

  await upsertRows(
    tenantPool,
    'ShiftEntry',
    ['id', 'date', 'doctor_id', 'position', 'order'],
    shiftEntries
  );

  await upsertRows(
    tenantPool,
    'WishRequest',
    ['id', 'doctor_id', 'target_month', 'start_date', 'end_date', 'position', 'type', 'status', 'comment'],
    wishRequests
  );

  await upsertRows(
    tenantPool,
    'TrainingRotation',
    ['id', 'doctor_id', 'title', 'workplace_id', 'start_date', 'end_date', 'status', 'notes'],
    trainingRotations
  );

  await upsertRows(
    tenantPool,
    'StaffingPlanEntry',
    ['id', 'doctor_id', 'workplace_id', 'date', 'start_time', 'end_time', 'status'],
    staffingPlanEntries
  );

  await upsertRows(
    tenantPool,
    'CustomHoliday',
    ['id', 'name', 'date', 'state_code'],
    customHolidays
  );

  await upsertRows(
    tenantPool,
    'SystemSetting',
    ['id', 'key', 'value'],
    systemSettings
  );

  await upsertRows(
    tenantPool,
    'ColorSetting',
    ['id', 'name', 'category', 'bg_color', 'text_color'],
    colorSettings
  );
}

async function main() {
  console.log('[seed] Starting deterministic test data seed');
  console.log(`[seed] Master DB: ${MASTER_DB_NAME}`);
  console.log(`[seed] Tenant DB: ${TENANT_DB_NAME}`);

  let rootPool;
  let masterPool;
  let tenantPool;

  try {
    rootPool = await waitForPool('mysql root', () => createPool({ user: 'root', password: MYSQL_ROOT_PASSWORD }));
    await ensureTenantDatabase(rootPool);

    masterPool = await waitForPool('master database', () => createPool({ database: MASTER_DB_NAME, user: MYSQL_USER, password: MYSQL_PASSWORD }));
    await ensureMasterBaseTables(masterPool);
    await runMasterMigrations(masterPool);

    tenantPool = await waitForPool('tenant database', () => createPool({ database: TENANT_DB_NAME, user: MYSQL_USER, password: MYSQL_PASSWORD }));
    await ensureTenantBaseTables(tenantPool);
    await runTenantMigrations(tenantPool, TENANT_ID);

    await upsertDbToken(masterPool);
    await upsertMasterUsers(masterPool);
    await seedTenantData(tenantPool);

    console.log('[seed] Done');
    console.log('  test users seeded: admin@test.local, user@test.local, readonly@test.local');
    console.log(`[seed] Tenant token id: ${TENANT_ID}`);
  } finally {
    await Promise.all([
      tenantPool?.end().catch(() => {}),
      masterPool?.end().catch(() => {}),
      rootPool?.end().catch(() => {}),
    ]);
  }
}

main().catch((error) => {
  console.error('[seed] Failed:', error);
  process.exitCode = 1;
});
