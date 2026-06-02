import { ensureColumns, hasTable } from '../utils/schema.js';

async function executeStatements(pool, statements) {
  for (const statement of statements) {
    await pool.execute(statement);
  }
}

export async function ensureMasterBaseTables(masterPool) {
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
      wish_default_position VARCHAR(255) DEFAULT NULL,
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

  if (await hasTable(masterPool, 'SystemLog')) {
    await ensureColumns(masterPool, 'SystemLog', [
      ['details', 'TEXT DEFAULT NULL'],
      ['updated_date', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
      ['created_by', 'VARCHAR(255) DEFAULT NULL'],
    ]);
  }
}

export async function ensureTenantBaseTables(tenantPool) {
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
      central_employee_id VARCHAR(36) DEFAULT NULL,
      work_time_model_id VARCHAR(36) DEFAULT NULL,
      target_weekly_hours DECIMAL(4,1) DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed',
      INDEX idx_doctor_central_employee (central_employee_id)
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
      allows_absence_overlap TINYINT(1) DEFAULT 0,
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
      target_month VARCHAR(7) DEFAULT NULL,
      date DATE DEFAULT NULL,
      start_date DATE DEFAULT NULL,
      end_date DATE DEFAULT NULL,
      position VARCHAR(255) DEFAULT NULL,
      type VARCHAR(50) DEFAULT 'service',
      status VARCHAR(32) DEFAULT 'pending',
      priority VARCHAR(32) DEFAULT 'medium',
      reason TEXT DEFAULT NULL,
      admin_comment TEXT DEFAULT NULL,
      comment TEXT DEFAULT NULL,
      user_viewed TINYINT(1) DEFAULT 0,
      range_start DATE DEFAULT NULL,
      range_end DATE DEFAULT NULL,
      approved_by VARCHAR(255) DEFAULT NULL,
      approved_date DATETIME DEFAULT NULL,
      created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      created_by VARCHAR(255) DEFAULT 'seed'
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS TrainingRotation (
      id VARCHAR(36) PRIMARY KEY,
      doctor_id VARCHAR(36) NOT NULL,
      title VARCHAR(255) DEFAULT NULL,
      workplace_id VARCHAR(36) DEFAULT NULL,
      modality VARCHAR(255) DEFAULT NULL,
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
      year INT NOT NULL,
      month INT NOT NULL,
      \`value\` TEXT DEFAULT NULL,
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
      acknowledged TINYINT(1) DEFAULT 0,
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
      details TEXT,
      created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_by VARCHAR(255)
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

  await ensureColumns(tenantPool, 'ShiftNotification', [
    ['acknowledged', 'TINYINT(1) DEFAULT 0'],
  ]);

  // Patch WishRequest for tenants whose table predates the current schema.
  // CREATE TABLE IF NOT EXISTS above is a no-op for an existing table, so
  // tenants that onboarded earlier (e.g. before target_month existed) keep
  // the old shape and the Statistics page crashes with
  // "Unknown column 'target_month' in 'WHERE'" on a filter request. Mirror
  // the full column list from the CREATE TABLE statement above so the table
  // converges regardless of when it was first created. addColumnIfMissing
  // inside ensureColumns is a no-op when the column is already present, so
  // this is safe to call on every tenant access.
  await ensureColumns(tenantPool, 'WishRequest', [
    ['target_month', 'VARCHAR(7) DEFAULT NULL'],
    ['date', 'DATE DEFAULT NULL'],
    ['start_date', 'DATE DEFAULT NULL'],
    ['end_date', 'DATE DEFAULT NULL'],
    ['position', 'VARCHAR(255) DEFAULT NULL'],
    ['type', "VARCHAR(50) DEFAULT 'service'"],
    ['status', "VARCHAR(32) DEFAULT 'pending'"],
    ['priority', "VARCHAR(32) DEFAULT 'medium'"],
    ['reason', 'TEXT DEFAULT NULL'],
    ['admin_comment', 'TEXT DEFAULT NULL'],
    ['comment', 'TEXT DEFAULT NULL'],
    ['user_viewed', 'TINYINT(1) DEFAULT 0'],
    ['range_start', 'DATE DEFAULT NULL'],
    ['range_end', 'DATE DEFAULT NULL'],
    ['approved_by', 'VARCHAR(255) DEFAULT NULL'],
    ['approved_date', 'DATETIME DEFAULT NULL'],
  ]);
}

export async function upsertRows(pool, tableName, columns, rows) {
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
