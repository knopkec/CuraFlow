/**
 * Run all tenant-side migrations on a given database pool.
 * Idempotent — safe to call multiple times, skips already-applied migrations.
 * Used by:
 *  - POST /api/admin/run-timeslot-migrations (manual trigger)
 *  - tenantDbMiddleware (auto-trigger on first tenant access)
 */
import { clearColumnsCache } from './schema.js';

const FATAL_TENANT_MIGRATION_ERROR_CODES = new Set([
  'ER_ACCESS_DENIED_ERROR',
  'ER_DBACCESS_DENIED_ERROR',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
]);

const FATAL_TENANT_MIGRATION_ERROR_PATTERNS = [
  /pool is closed/i,
  /closed state/i,
  /can't add new command when connection is in closed state/i,
  /can't add new command when connection is closed/i,
  /the client was disconnected by the server/i,
];

function isFatalTenantMigrationError(error) {
  if (!error) return false;
  if (FATAL_TENANT_MIGRATION_ERROR_CODES.has(error.code)) {
    return true;
  }

  const message = `${error.message || ''} ${error.sqlMessage || ''}`.trim();
  return FATAL_TENANT_MIGRATION_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export async function runTenantMigrations(dbPool, cacheKey = 'default') {
  const results = [];

  const addCol = async (name, sql) => {
    try {
      await dbPool.execute(sql);
      results.push({ migration: name, status: 'success' });
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        results.push({ migration: name, status: 'skipped', reason: 'Column already exists' });
      } else if (isFatalTenantMigrationError(err)) {
        throw err;
      } else {
        results.push({ migration: name, status: 'error', error: err.message });
      }
    }
  };

  const createTbl = async (name, sql) => {
    try {
      await dbPool.execute(sql);
      results.push({ migration: name, status: 'success' });
    } catch (err) {
      if (err.code === 'ER_TABLE_EXISTS_ERROR') {
        results.push({ migration: name, status: 'skipped', reason: 'Table already exists' });
      } else if (isFatalTenantMigrationError(err)) {
        throw err;
      } else {
        results.push({ migration: name, status: 'error', error: err.message });
      }
    }
  };

  const createIdx = async (name, sql) => {
    try {
      await dbPool.execute(sql);
      results.push({ migration: name, status: 'success' });
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME') {
        results.push({ migration: name, status: 'skipped', reason: 'Index already exists' });
      } else if (isFatalTenantMigrationError(err)) {
        throw err;
      } else {
        results.push({ migration: name, status: 'error', error: err.message });
      }
    }
  };

  // ── 1. WorkplaceTimeslot table ──
  await createTbl('create_workplace_timeslot_table', `
    CREATE TABLE IF NOT EXISTS WorkplaceTimeslot (
      id VARCHAR(255) PRIMARY KEY,
      workplace_id VARCHAR(255) NOT NULL,
      label VARCHAR(100) NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      \`order\` INT DEFAULT 0,
      overlap_tolerance_minutes INT DEFAULT 0,
      spans_midnight BOOLEAN DEFAULT FALSE,
      created_date DATETIME(3),
      updated_date DATETIME(3),
      created_by VARCHAR(255),
      INDEX idx_timeslot_workplace (workplace_id)
    )
  `);

  // ── 2-3. Workplace columns ──
  await addCol('add_workplace_timeslots_enabled',
    `ALTER TABLE Workplace ADD COLUMN timeslots_enabled BOOLEAN DEFAULT FALSE`);
  await addCol('add_workplace_overlap_tolerance',
    `ALTER TABLE Workplace ADD COLUMN default_overlap_tolerance_minutes INT DEFAULT 15`);

  // ── 4-5. ShiftEntry timeslot ──
  await addCol('add_shiftentry_timeslot_id',
    `ALTER TABLE ShiftEntry ADD COLUMN timeslot_id VARCHAR(255) DEFAULT NULL`);
  await createIdx('add_shiftentry_timeslot_index',
    `CREATE INDEX idx_shiftentry_timeslot ON ShiftEntry(timeslot_id)`);

  // ── 6. TimeslotTemplate ──
  await createTbl('create_timeslot_template_table', `
    CREATE TABLE IF NOT EXISTS TimeslotTemplate (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slots_json TEXT NOT NULL,
      created_date DATETIME(3),
      updated_date DATETIME(3),
      created_by VARCHAR(255)
    )
  `);

  // ── 7. Workplace work_time_percentage ──
  await addCol('add_workplace_work_time_percentage',
    `ALTER TABLE Workplace ADD COLUMN work_time_percentage DECIMAL(5,2) DEFAULT 100.00`);

  // ── 8. TeamRole permissions ──
  try {
    const alterStatements = [
      `ALTER TABLE TeamRole ADD COLUMN can_do_foreground_duty BOOLEAN NOT NULL DEFAULT TRUE`,
      `ALTER TABLE TeamRole ADD COLUMN can_do_background_duty BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE TeamRole ADD COLUMN excluded_from_statistics BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE TeamRole ADD COLUMN description VARCHAR(255) DEFAULT NULL`
    ];
    let addedColumns = 0;
    for (const stmt of alterStatements) {
      try { await dbPool.execute(stmt); addedColumns++; } catch { /* column exists */ }
    }
    if (addedColumns > 0) {
      await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = FALSE, can_do_background_duty = TRUE, description = 'Oberste Führungsebene' WHERE name = 'Chefarzt' AND description IS NULL`);
      await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = FALSE, can_do_background_duty = TRUE, description = 'Kann Hintergrunddienste übernehmen' WHERE name = 'Oberarzt' AND description IS NULL`);
      await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = TRUE, can_do_background_duty = TRUE, description = 'Kann alle Dienste übernehmen' WHERE name = 'Facharzt' AND description IS NULL`);
      await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = TRUE, can_do_background_duty = FALSE, description = 'Kann Vordergrunddienste übernehmen' WHERE name = 'Assistenzarzt' AND description IS NULL`);
      await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = FALSE, can_do_background_duty = FALSE, excluded_from_statistics = TRUE, description = 'Wird in Statistiken nicht gezählt' WHERE name = 'Nicht-Radiologe' AND description IS NULL`);
      results.push({ migration: 'add_team_role_permissions', status: 'success', message: `${addedColumns} columns added` });
    } else {
      results.push({ migration: 'add_team_role_permissions', status: 'skipped', reason: 'Columns already exist' });
    }
  } catch (err) {
    results.push({ migration: 'add_team_role_permissions', status: 'error', error: err.message });
  }

  // ── 9. Workplace affects_availability ──
  await addCol('add_workplace_affects_availability',
    `ALTER TABLE Workplace ADD COLUMN affects_availability BOOLEAN DEFAULT TRUE`);

  // ── 9b. Workplace allows_absence_overlap ──
  await addCol('add_workplace_allows_absence_overlap',
    `ALTER TABLE Workplace ADD COLUMN allows_absence_overlap BOOLEAN DEFAULT FALSE`);

  // ── 10. Workplace staffing ──
  await addCol('add_workplace_min_staff',
    `ALTER TABLE Workplace ADD COLUMN min_staff INT DEFAULT 1`);
  await addCol('add_workplace_optimal_staff',
    `ALTER TABLE Workplace ADD COLUMN optimal_staff INT DEFAULT 1`);

  // ── 11. WorkplaceQualification is_excluded ──
  await addCol('add_workplace_qualification_is_excluded',
    `ALTER TABLE WorkplaceQualification ADD COLUMN is_excluded BOOLEAN NOT NULL DEFAULT FALSE`);

  // ── 11b. Qualification requires_certificate ──
  await addCol('add_qualification_requires_certificate',
    `ALTER TABLE Qualification ADD COLUMN requires_certificate BOOLEAN NOT NULL DEFAULT FALSE`);
  await addCol('add_qualification_certificate_requirement_mode',
    `ALTER TABLE Qualification ADD COLUMN certificate_requirement_mode VARCHAR(32) DEFAULT 'single_document'`);
  await addCol('add_qualification_certificate_validity_months',
    `ALTER TABLE Qualification ADD COLUMN certificate_validity_months INT DEFAULT NULL`);
  await addCol('add_qualification_certificate_refresh_validity_months',
    `ALTER TABLE Qualification ADD COLUMN certificate_refresh_validity_months INT DEFAULT NULL`);
  await addCol('add_qualification_certificate_base_label',
    `ALTER TABLE Qualification ADD COLUMN certificate_base_label VARCHAR(100) DEFAULT 'Grundnachweis'`);
  await addCol('add_qualification_certificate_refresh_label',
    `ALTER TABLE Qualification ADD COLUMN certificate_refresh_label VARCHAR(100) DEFAULT 'Verlängerung / Auffrischung'`);
  await addCol('add_doctorqualification_certificate_status',
    `ALTER TABLE DoctorQualification ADD COLUMN certificate_status VARCHAR(32) DEFAULT NULL`);
  await addCol('add_doctorqualification_certificate_valid_from',
    `ALTER TABLE DoctorQualification ADD COLUMN certificate_valid_from DATE DEFAULT NULL`);
  await addCol('add_doctorqualification_certificate_valid_until',
    `ALTER TABLE DoctorQualification ADD COLUMN certificate_valid_until DATE DEFAULT NULL`);
  await addCol('add_doctorqualification_certificate_status_reason',
    `ALTER TABLE DoctorQualification ADD COLUMN certificate_status_reason VARCHAR(500) DEFAULT NULL`);

  // ── 12. Workplace service_type ──
  try {
    await dbPool.execute(`ALTER TABLE Workplace ADD COLUMN service_type INT DEFAULT NULL`);
    results.push({ migration: 'add_workplace_service_type', status: 'success' });
    try {
      const [serviceWps] = await dbPool.execute(
        `SELECT id, \`order\` FROM Workplace WHERE category = 'Dienste' ORDER BY COALESCE(\`order\`, 0) ASC`
      );
      if (serviceWps.length > 0) {
        await dbPool.execute(`UPDATE Workplace SET service_type = 1 WHERE id = ?`, [serviceWps[0].id]);
        if (serviceWps.length > 1) {
          const otherIds = serviceWps.slice(1).map(w => w.id);
          await dbPool.execute(
            `UPDATE Workplace SET service_type = 2 WHERE id IN (${otherIds.map(() => '?').join(',')})`,
            otherIds
          );
        }
      }
    } catch { /* data migration optional */ }
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      results.push({ migration: 'add_workplace_service_type', status: 'skipped', reason: 'Column already exists' });
    } else if (isFatalTenantMigrationError(err)) {
      throw err;
    } else {
      results.push({ migration: 'add_workplace_service_type', status: 'error', error: err.message });
    }
  }

  // ── PHASE 0: Central Employee Management ──
  await addCol('add_doctor_central_employee_id',
    `ALTER TABLE Doctor ADD COLUMN central_employee_id VARCHAR(36) DEFAULT NULL`);
  await createIdx('add_doctor_central_employee_index',
    `CREATE INDEX idx_doctor_central_employee ON Doctor(central_employee_id)`);

  // ── PHASE 1: Work Time Models ──
  await addCol('add_doctor_work_time_model_id',
    `ALTER TABLE Doctor ADD COLUMN work_time_model_id VARCHAR(36) DEFAULT NULL`);

  await createTbl('create_shift_time_rule_table', `
    CREATE TABLE IF NOT EXISTS ShiftTimeRule (
      id VARCHAR(36) PRIMARY KEY,
      workplace_id VARCHAR(255) NOT NULL,
      work_time_model_id VARCHAR(36) NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      break_minutes INT DEFAULT 0,
      label VARCHAR(100),
      spans_midnight BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_workplace_model (workplace_id, work_time_model_id),
      INDEX idx_workplace (workplace_id),
      INDEX idx_model (work_time_model_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // ── PHASE 2: ShiftEntry time fields ──
  await addCol('add_shiftentry_start_time',
    `ALTER TABLE ShiftEntry ADD COLUMN start_time TIME DEFAULT NULL`);
  await addCol('add_shiftentry_end_time',
    `ALTER TABLE ShiftEntry ADD COLUMN end_time TIME DEFAULT NULL`);
  await addCol('add_shiftentry_break_minutes',
    `ALTER TABLE ShiftEntry ADD COLUMN break_minutes INT DEFAULT NULL`);

  // ── Doctor: Vertragliche Wochenstunden (Wochen-h wie in Excel) ──
  await addCol('add_doctor_target_weekly_hours',
    `ALTER TABLE Doctor ADD COLUMN target_weekly_hours DECIMAL(4,1) DEFAULT NULL`);

  // ── ShiftTimeRule: Kürzel (short_code) für Dienstmodelle ──
  await addCol('add_shift_time_rule_short_code',
    `ALTER TABLE ShiftTimeRule ADD COLUMN short_code VARCHAR(20) DEFAULT NULL`);

  // ── ShiftTimeRule: Unique Key ändern für multi-Modell pro Workplace ──
  try {
    const [keys] = await dbPool.execute(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ShiftTimeRule'
       AND CONSTRAINT_NAME = 'uk_workplace_model' AND CONSTRAINT_TYPE = 'UNIQUE'`
    );
    if (keys.length > 0) {
      await dbPool.execute(`ALTER TABLE ShiftTimeRule DROP INDEX uk_workplace_model`);
      results.push({ migration: 'drop_uk_workplace_model', status: 'applied' });
    }
  } catch (e) {
    // Already dropped or doesn't exist
  }
  try {
    await dbPool.execute(
      `ALTER TABLE ShiftTimeRule ADD UNIQUE KEY uk_shortcode_model (short_code, work_time_model_id)`
    );
    results.push({ migration: 'add_uk_shortcode_model', status: 'applied' });
  } catch (e) {
    if (e.code === 'ER_DUP_KEYNAME') {
      results.push({ migration: 'add_uk_shortcode_model', status: 'skipped', reason: 'Unique key already exists' });
    } else if (isFatalTenantMigrationError(e)) {
      throw e;
    } else {
      results.push({ migration: 'add_uk_shortcode_model', status: 'error', error: e.message });
    }
  }

  // Clear column cache so new columns are recognized immediately when running inside the server.
  try {
    clearColumnsCache([
      'Workplace', 'WorkplaceTimeslot', 'ShiftEntry', 'TimeslotTemplate',
      'TeamRole', 'WorkplaceQualification', 'Qualification', 'DoctorQualification', 'Doctor', 'ShiftTimeRule'
    ], cacheKey);
  } catch (error) {
    results.push({ migration: 'clear_columns_cache', status: 'error', error: error.message });
  }

  return results;
}
