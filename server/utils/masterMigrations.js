export async function runMasterMigrations(dbPool) {
  const results = [];
  const SKIPPED = Symbol('skipped');

  const hasColumn = async (tableName, columnName) => {
    const [rows] = await dbPool.execute(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tableName, columnName]
    );
    return Number(rows[0]?.cnt || 0) > 0;
  };

  const addColumnIfMissing = async (tableName, columnName, definition) => {
    if (await hasColumn(tableName, columnName)) {
      return false;
    }

    await dbPool.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
    return true;
  };

  const getColumnInfo = async (tableName, columnName) => {
    const [rows] = await dbPool.execute(
      `SELECT COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tableName, columnName]
    );
    return rows[0] || null;
  };

  const run = async (migration, execute, options = {}) => {
    const {
      duplicateCodes = [],
      duplicateReason = 'Bereits vorhanden',
      skippedReason = 'Bereits vorhanden',
    } = options;

    try {
      const outcome = await execute();
      if (outcome === SKIPPED || outcome === false) {
        results.push({ migration, status: 'skipped', reason: skippedReason });
        return;
      }
      results.push({ migration, status: 'success' });
    } catch (err) {
      if (duplicateCodes.includes(err.code)) {
        results.push({ migration, status: 'skipped', reason: duplicateReason });
        return;
      }

      results.push({ migration, status: 'error', error: err.message });
    }
  };

  await run('add_allowed_tenants', async () => {
    const changed = await addColumnIfMissing('app_users', 'allowed_tenants', 'JSON DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_must_change_password', async () => {
    const changed = await addColumnIfMissing('app_users', 'must_change_password', 'BOOLEAN DEFAULT FALSE');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_email_verified', async () => {
    const addedEmailVerified = await addColumnIfMissing('app_users', 'email_verified', 'TINYINT(1) DEFAULT 0');
    const addedEmailVerifiedDate = await addColumnIfMissing('app_users', 'email_verified_date', 'DATETIME DEFAULT NULL');
    return addedEmailVerified || addedEmailVerifiedDate || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalten bereits vorhanden', skippedReason: 'Spalten bereits vorhanden' });

  await run('add_last_seen_at', async () => {
    const changed = await addColumnIfMissing('app_users', 'last_seen_at', 'DATETIME DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_schedule_initials_only', async () => {
    const changed = await addColumnIfMissing('app_users', 'schedule_initials_only', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_schedule_sort_doctors_alphabetically', async () => {
    const changed = await addColumnIfMissing('app_users', 'schedule_sort_doctors_alphabetically', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_schedule_show_time_account', async () => {
    const changed = await addColumnIfMissing('app_users', 'schedule_show_time_account', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_wish_default_position', async () => {
    const changed = await addColumnIfMissing('app_users', 'wish_default_position', 'VARCHAR(255) DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('create_email_verification_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS EmailVerification (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        token VARCHAR(64) NOT NULL UNIQUE,
        type ENUM('email_verify', 'password_sent') NOT NULL DEFAULT 'email_verify',
        status ENUM('pending', 'verified', 'expired') NOT NULL DEFAULT 'pending',
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verified_date TIMESTAMP NULL,
        expires_date TIMESTAMP NULL,
        INDEX idx_token (token),
        INDEX idx_user_id (user_id)
      )
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_cowork_invite_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS CoWorkInvite (
        id VARCHAR(36) PRIMARY KEY,
        room_name VARCHAR(128) NOT NULL,
        tenant_slug VARCHAR(64) NOT NULL,
        inviter_user_id VARCHAR(36) NOT NULL,
        invitee_user_id VARCHAR(36) NOT NULL,
        status ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
        responded_date TIMESTAMP NULL,
        expires_date TIMESTAMP NULL,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_invitee_status (invitee_user_id, status),
        INDEX idx_inviter_status (inviter_user_id, status),
        INDEX idx_room_name (room_name),
        INDEX idx_expires_date (expires_date)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await dbPool.execute(`ALTER TABLE CoWorkInvite CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_schedule_block_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS ScheduleBlock (
        id VARCHAR(36) PRIMARY KEY,
        date DATE NOT NULL,
        position VARCHAR(255) NOT NULL,
        timeslot_id VARCHAR(36) DEFAULT NULL,
        reason VARCHAR(500) DEFAULT NULL,
        created_by VARCHAR(255) DEFAULT NULL,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_block (date, position, timeslot_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // ===== PHASE 0: Central Employee Management =====

  await run('create_employee_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS Employee (
        id VARCHAR(36) PRIMARY KEY,
        payroll_id VARCHAR(50),
        last_name VARCHAR(200) NOT NULL,
        first_name VARCHAR(100),
        former_name VARCHAR(200),
        date_of_birth DATE,
        email VARCHAR(255),
        phone VARCHAR(50),
        address TEXT,
        contract_type ENUM('vollzeit','teilzeit','minijob','werkstudent','praktikant','honorar') DEFAULT NULL,
        contract_start DATE,
        contract_end DATE,
        probation_end DATE,
        target_hours_per_week DECIMAL(4,1) DEFAULT 38.5,
        vacation_days_annual INT DEFAULT 30,
        is_active BOOLEAN DEFAULT TRUE,
        exit_date DATE,
        exit_reason VARCHAR(255),
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_by VARCHAR(255),
        INDEX idx_payroll (payroll_id),
        INDEX idx_active (is_active),
        INDEX idx_name (last_name, first_name)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_employee_tenant_assignment_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS EmployeeTenantAssignment (
        id VARCHAR(36) PRIMARY KEY,
        employee_id VARCHAR(36) NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        tenant_doctor_id VARCHAR(255),
        assigned_since DATE,
        is_primary BOOLEAN DEFAULT FALSE,
        fte_share DECIMAL(3,2) DEFAULT 1.00,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_employee_tenant (employee_id, tenant_id),
        INDEX idx_employee (employee_id),
        INDEX idx_tenant (tenant_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_central_absence_entry_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS CentralAbsenceEntry (
        id VARCHAR(36) PRIMARY KEY,
        employee_id VARCHAR(36) NOT NULL,
        date DATE NOT NULL,
        position VARCHAR(255) NOT NULL,
        note TEXT,
        start_time TIME DEFAULT NULL,
        end_time TIME DEFAULT NULL,
        break_minutes INT DEFAULT NULL,
        timeslot_id VARCHAR(36) DEFAULT NULL,
        \`order\` INT DEFAULT NULL,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_by VARCHAR(255) DEFAULT NULL,
        source_tenant_id VARCHAR(36) DEFAULT NULL,
        source_tenant_doctor_id VARCHAR(255) DEFAULT NULL,
        UNIQUE KEY uk_central_absence_employee_date (employee_id, date),
        INDEX idx_central_absence_employee (employee_id),
        INDEX idx_central_absence_date (date)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // ===== Employee Relationships =====

  await run('create_employee_relationship_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS EmployeeRelationship (
        id VARCHAR(36) PRIMARY KEY,
        employee_id VARCHAR(36) NOT NULL,
        related_employee_id VARCHAR(36) NOT NULL,
        relationship_type VARCHAR(100) NOT NULL DEFAULT 'lebensgemeinschaft',
        shift_conflict BOOLEAN NOT NULL DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_by VARCHAR(255) DEFAULT NULL,
        UNIQUE KEY uk_relationship_pair (employee_id, related_employee_id),
        INDEX idx_relationship_employee (employee_id),
        INDEX idx_relationship_related (related_employee_id),
        CONSTRAINT fk_relationship_employee FOREIGN KEY (employee_id) REFERENCES Employee(id) ON DELETE CASCADE,
        CONSTRAINT fk_relationship_related FOREIGN KEY (related_employee_id) REFERENCES Employee(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // ===== PHASE 1: Work Time Models =====

  await run('create_work_time_model_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS WorkTimeModel (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        hours_per_week DECIMAL(4,1) NOT NULL,
        hours_per_day DECIMAL(4,2) NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        description VARCHAR(255),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_default (is_default)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);

    // Seed standard work time models (idempotent via INSERT IGNORE)
    const models = [
      { id: 'wtm-vz-39', name: 'Vollzeit 39h', hpw: 39.0, hpd: 7.80, def: true },
      { id: 'wtm-vz-40', name: 'Vollzeit 40h', hpw: 40.0, hpd: 8.00, def: false },
      { id: 'wtm-tz-35', name: 'Teilzeit 35h', hpw: 35.0, hpd: 7.00, def: false },
      { id: 'wtm-tz-30', name: 'Teilzeit 30h', hpw: 30.0, hpd: 6.00, def: false },
      { id: 'wtm-tz-20', name: 'Teilzeit 20h', hpw: 20.0, hpd: 4.00, def: false },
      { id: 'wtm-mini-8', name: 'Minijob 8h', hpw: 8.0, hpd: 8.00, def: false },
      { id: 'wtm-tz-385', name: 'Vollzeit 38.5h (Pflege)', hpw: 38.5, hpd: 7.70, def: false },
    ];
    for (const m of models) {
      await dbPool.execute(
        `INSERT IGNORE INTO WorkTimeModel (id, name, hours_per_week, hours_per_day, is_default, description) VALUES (?, ?, ?, ?, ?, ?)`,
        [m.id, m.name, m.hpw, m.hpd, m.def, null]
      );
    }
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('add_employee_work_time_model_id', async () => {
    const changed = await addColumnIfMissing('Employee', 'work_time_model_id', 'VARCHAR(36) DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  // ===== PHASE 4: Time Accounts (Master-DB) =====

  // ===== Qualification Certificates (central, multi-tenant) =====
  // Stores certificate files (PDF/JPEG/PNG) for qualifications that require proof
  // (e.g. Strahlenschutz). tenant_key = sha256(host:database) of the tenant DB.
  await run('create_qualification_certificate_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS QualificationCertificate (
        id VARCHAR(36) PRIMARY KEY,
        tenant_key VARCHAR(64) NOT NULL,
        doctor_id VARCHAR(255) NOT NULL,
        qualification_id VARCHAR(255) NOT NULL,
        doctor_qualification_id VARCHAR(255) DEFAULT NULL,
        evidence_role VARCHAR(32) DEFAULT 'single',
        file_name VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        file_size INT NOT NULL,
        file_data MEDIUMBLOB NOT NULL,
        granted_date DATE DEFAULT NULL,
        expiry_date DATE DEFAULT NULL,
        notes VARCHAR(500) DEFAULT NULL,
        uploaded_by VARCHAR(36) DEFAULT NULL,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_qc_tenant (tenant_key),
        INDEX idx_qc_doctor (tenant_key, doctor_id),
        INDEX idx_qc_qual (tenant_key, qualification_id),
        INDEX idx_qc_expiry (tenant_key, expiry_date)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // Add LLM analysis columns to QualificationCertificate (idempotent)
  await run('add_qc_analysis_columns', async () => {
    const columns = [
      ['evidence_role', `VARCHAR(32) DEFAULT 'single'`],
      ['analysis_status', `ENUM('pending','passed','warning','failed','skipped','error') DEFAULT 'pending'`],
      ['analysis_is_certificate', 'TINYINT(1) DEFAULT NULL'],
      ['analysis_scope_match', 'TINYINT(1) DEFAULT NULL'],
      ['analysis_scope_detected', 'VARCHAR(255) DEFAULT NULL'],
      ['analysis_confidence', 'FLOAT DEFAULT NULL'],
      ['analysis_reasoning', 'TEXT DEFAULT NULL'],
      ['analysis_detected_granted', 'DATE DEFAULT NULL'],
      ['analysis_detected_expiry', 'DATE DEFAULT NULL'],
      ['analyzed_at', 'DATETIME DEFAULT NULL'],
    ];
    let changed = false;

    for (const [columnName, definition] of columns) {
      const added = await addColumnIfMissing('QualificationCertificate', columnName, definition);
      changed = changed || added;
    }

    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalten bereits vorhanden', skippedReason: 'Spalten bereits vorhanden' });


  await run('create_time_account_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS TimeAccount (
        id VARCHAR(36) PRIMARY KEY,
        employee_id VARCHAR(36) NOT NULL,
        year INT NOT NULL,
        month INT NOT NULL,
        target_minutes INT DEFAULT 0,
        actual_minutes INT DEFAULT 0,
        balance_minutes INT DEFAULT 0,
        carry_over_minutes INT DEFAULT 0,
        status ENUM('open','provisional','closed') DEFAULT 'open',
        closed_by VARCHAR(255),
        closed_at DATETIME,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_employee_period (employee_id, year, month),
        INDEX idx_employee (employee_id),
        INDEX idx_period (year, month),
        INDEX idx_status (status)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // ===== Tenant Groups (Cross-Department Pools) =====
  // See docs/features/TENANT_GROUPS.md
  // A tenant_group bundles several db_tokens (departments) so that
  // cross-department admins can manage shared pool shifts (AD, KWE, OD, ...).
  //
  // FK note: db_tokens.id was originally created without an explicit
  // collation, so it inherits whatever the schema default is (commonly
  // utf8mb4_0900_ai_ci on MySQL 8). InnoDB FKs require referencing and
  // referenced VARCHAR columns to share charset+collation. We therefore
  // detect db_tokens.id's actual collation and clone it onto every new
  // table that needs to FK against it.
  const [collRows] = await dbPool.execute(
    `SELECT CHARACTER_SET_NAME AS cs, COLLATION_NAME AS co
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'db_tokens'
        AND COLUMN_NAME = 'id'`
  );
  const dbTokensCharset = collRows[0]?.cs || 'utf8mb4';
  const dbTokensCollation = collRows[0]?.co || 'utf8mb4_0900_ai_ci';
  const fkTableSuffix = `CHARACTER SET ${dbTokensCharset} COLLATE ${dbTokensCollation}`;

  await run('create_tenant_group_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS tenant_group (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        description TEXT DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY uk_tenant_group_name (name)
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  // Idempotent fix-up: if any of these tables were created in a previous
  // deploy with the wrong collation (so the FK to db_tokens(id) can't be
  // formed), drop them in dependency order if they are still empty. The
  // create migrations below will then rebuild them with the correct
  // collation. Tables that already hold data are left untouched and any
  // mismatch will surface in the subsequent create step.
  await run('fix_tenant_group_tables_collation', async () => {
    // Child-first order
    const tables = [
      'shared_workplace_quota',
      'shared_shift_entry',
      'shared_workplace',
      'tenant_group_member',
    ];
    let changed = false;
    for (const t of tables) {
      const [tRows] = await dbPool.execute(
        `SELECT TABLE_COLLATION AS co FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [t]
      );
      const current = tRows[0]?.co;
      if (!current || current === dbTokensCollation) continue;

      const [cntRows] = await dbPool.execute(`SELECT COUNT(*) AS cnt FROM \`${t}\``);
      const rowCount = Number(cntRows[0]?.cnt || 0);
      if (rowCount > 0) {
        // Leave non-empty tables alone — operator must migrate data manually.
        continue;
      }

      await dbPool.query(`DROP TABLE \`${t}\``);
      changed = true;
    }
    return changed || SKIPPED;
  }, { skippedReason: 'Collation bereits korrekt' });

  await run('create_tenant_group_member_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS tenant_group_member (
        group_id INT NOT NULL,
        tenant_id VARCHAR(36) NOT NULL,
        role ENUM('member','observer') NOT NULL DEFAULT 'member',
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (group_id, tenant_id),
        INDEX idx_tgm_tenant (tenant_id),
        CONSTRAINT fk_tgm_group FOREIGN KEY (group_id) REFERENCES tenant_group(id) ON DELETE CASCADE,
        CONSTRAINT fk_tgm_tenant FOREIGN KEY (tenant_id) REFERENCES db_tokens(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_shared_workplace_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS shared_workplace (
        id VARCHAR(36) PRIMARY KEY,
        group_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) DEFAULT NULL,
        start_time TIME DEFAULT NULL,
        end_time TIME DEFAULT NULL,
        active_days JSON DEFAULT NULL,
        allows_multiple TINYINT(1) DEFAULT 0,
        min_staff INT NOT NULL DEFAULT 1,
        optimal_staff INT NOT NULL DEFAULT 1,
        default_overlap_tolerance_minutes INT DEFAULT 15,
        work_time_percentage DECIMAL(5,2) DEFAULT 100.00,
        service_type INT DEFAULT NULL,
        auto_off TINYINT(1) DEFAULT 0,
        allows_rotation_concurrently TINYINT(1) DEFAULT 0,
        affects_availability TINYINT(1) NOT NULL DEFAULT 1,
        allows_absence_overlap TINYINT(1) DEFAULT 0,
        timeslots_enabled TINYINT(1) DEFAULT 0,
        consecutive_days_mode VARCHAR(20) DEFAULT 'allowed',
        constraints_json JSON DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT NULL,
        INDEX idx_shared_workplace_group (group_id, is_active),
        CONSTRAINT fk_swp_group FOREIGN KEY (group_id) REFERENCES tenant_group(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_shared_workplace_timeslot_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS shared_workplace_timeslot (
        id VARCHAR(36) PRIMARY KEY,
        shared_workplace_id VARCHAR(36) NOT NULL,
        label VARCHAR(100) NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        \`order\` INT DEFAULT 0,
        overlap_tolerance_minutes INT DEFAULT 0,
        spans_midnight TINYINT(1) DEFAULT 0,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT NULL,
        INDEX idx_swt_workplace (shared_workplace_id),
        CONSTRAINT fk_swt_workplace FOREIGN KEY (shared_workplace_id) REFERENCES shared_workplace(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_shared_shift_entry_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS shared_shift_entry (
        id VARCHAR(36) PRIMARY KEY,
        shared_workplace_id VARCHAR(36) NOT NULL,
        date DATE NOT NULL,
        employee_id VARCHAR(36) NOT NULL,
        billing_tenant_id VARCHAR(36) NOT NULL,
        start_time TIME DEFAULT NULL,
        end_time TIME DEFAULT NULL,
        note TEXT DEFAULT NULL,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT NULL,
        INDEX idx_sse_date (date),
        INDEX idx_sse_emp_date (employee_id, date),
        INDEX idx_sse_billing (billing_tenant_id, date),
        INDEX idx_sse_workplace_date (shared_workplace_id, date),
        CONSTRAINT fk_sse_workplace FOREIGN KEY (shared_workplace_id) REFERENCES shared_workplace(id) ON DELETE CASCADE,
        CONSTRAINT fk_sse_billing FOREIGN KEY (billing_tenant_id) REFERENCES db_tokens(id)
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('align_shared_shift_entry_billing_tenant_id', async () => {
    const sourceColumn = await getColumnInfo('db_tokens', 'id');
    const targetColumn = await getColumnInfo('shared_shift_entry', 'billing_tenant_id');
    if (!sourceColumn || !targetColumn) {
      return SKIPPED;
    }

    const sameType = sourceColumn.COLUMN_TYPE === targetColumn.COLUMN_TYPE;
    const sameCharset = (sourceColumn.CHARACTER_SET_NAME || null) === (targetColumn.CHARACTER_SET_NAME || null);
    const sameCollation = (sourceColumn.COLLATION_NAME || null) === (targetColumn.COLLATION_NAME || null);
    if (sameType && sameCharset && sameCollation) {
      return SKIPPED;
    }

    const charsetSql = sourceColumn.CHARACTER_SET_NAME ? ` CHARACTER SET ${sourceColumn.CHARACTER_SET_NAME}` : '';
    const collationSql = sourceColumn.COLLATION_NAME ? ` COLLATE ${sourceColumn.COLLATION_NAME}` : '';
    await dbPool.execute(
      `ALTER TABLE \`shared_shift_entry\` MODIFY COLUMN \`billing_tenant_id\` ${sourceColumn.COLUMN_TYPE}${charsetSql}${collationSql} NOT NULL`
    );
    return true;
  }, { skippedReason: 'Spaltentyp bereits kompatibel' });

  await run('create_shared_workplace_qualification_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS shared_workplace_qualification (
        id INT AUTO_INCREMENT PRIMARY KEY,
        shared_workplace_id VARCHAR(36) NOT NULL,
        qualification_name VARCHAR(255) NOT NULL,
        is_excluded TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_swq_workplace_name (shared_workplace_id, qualification_name),
        CONSTRAINT fk_swq_qual_workplace FOREIGN KEY (shared_workplace_id) REFERENCES shared_workplace(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('create_shared_workplace_quota_table', async () => {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS shared_workplace_quota (
        shared_workplace_id VARCHAR(36) NOT NULL,
        scope ENUM('person','tenant','role') NOT NULL,
        scope_key VARCHAR(64) NOT NULL,
        period ENUM('month','quarter','year') NOT NULL DEFAULT 'month',
        max_count INT DEFAULT NULL,
        target_count INT DEFAULT NULL,
        weight DECIMAL(4,2) NOT NULL DEFAULT 1.00,
        PRIMARY KEY (shared_workplace_id, scope, scope_key, period),
        CONSTRAINT fk_swq_workplace FOREIGN KEY (shared_workplace_id) REFERENCES shared_workplace(id) ON DELETE CASCADE
      ) ${fkTableSuffix}
    `);
  }, { duplicateCodes: ['ER_TABLE_EXISTS_ERROR'], duplicateReason: 'Tabelle bereits vorhanden' });

  await run('add_app_users_allowed_groups', async () => {
    const changed = await addColumnIfMissing('app_users', 'allowed_groups', 'JSON DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_app_users_group_admin_groups', async () => {
    const changed = await addColumnIfMissing('app_users', 'group_admin_groups', 'JSON DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_active_days', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'active_days', 'JSON DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_allows_multiple', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'allows_multiple', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_overlap_tolerance', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'default_overlap_tolerance_minutes', 'INT DEFAULT 15');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_work_time_percentage', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'work_time_percentage', 'DECIMAL(5,2) DEFAULT 100.00');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_service_type', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'service_type', 'INT DEFAULT NULL');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_auto_off', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'auto_off', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_allows_rotation_concurrently', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'allows_rotation_concurrently', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_allows_absence_overlap', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'allows_absence_overlap', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  await run('add_shared_workplace_timeslots_enabled', async () => {
    const changed = await addColumnIfMissing('shared_workplace', 'timeslots_enabled', 'TINYINT(1) DEFAULT 0');
    return changed || SKIPPED;
  }, { duplicateCodes: ['ER_DUP_FIELDNAME'], duplicateReason: 'Spalte bereits vorhanden', skippedReason: 'Spalte bereits vorhanden' });

  return results;
}
