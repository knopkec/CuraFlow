import express from 'express';
import { db, removeTenantPool } from '../index.js';
import { authMiddleware } from './auth.js';
import crypto from 'crypto';
import { broadcastPlanUpdate, buildRealtimeScope, isPlanSyncEntity } from '../utils/realtime.js';
import { COLUMNS_CACHE, clearColumnsCache, ensureColumns } from '../utils/schema.js';
import { ensureTenantBaseTables } from '../scripts/seed-runtime-shared.js';
import {
  deleteCentralAbsenceById,
  getShiftEntryWithCentralAbsence,
  isCentralAbsencePosition,
  listShiftEntriesWithCentralAbsences,
  writeShiftEntryToCentralAbsence,
} from '../utils/centralAbsences.js';
import { resolveTenantIdFromToken } from '../utils/tenantGroups.js';

const router = express.Router();

// Tables that can be read without authentication
const PUBLIC_READ_TABLES = [
  'SystemSetting',
  'ColorSetting',
  'Workplace',
  'DemoSetting',
  'TeamRole',
  'Qualification',
  'DoctorQualification',
  'WorkplaceQualification'
];

const TENANT_BASE_TABLES = [
  'Doctor',
  'Workplace',
  'ShiftEntry',
  'WishRequest',
  'TrainingRotation',
  'ScheduleRule',
  'ColorSetting',
  'ScheduleNote',
  'SystemSetting',
  'CustomHoliday',
  'StaffingPlanEntry',
  'ShiftNotification',
  'DemoSetting',
  'BackupLog',
  'SystemLog',
  'VoiceAlias',
  'TeamRole',
  'Qualification',
  'DoctorQualification',
  'WorkplaceQualification',
  'ScheduleBlock',
];
const TENANT_BASE_TABLE_SET = new Set(TENANT_BASE_TABLES);

export { clearColumnsCache };

// HELPER: Convert JS value to MySQL value
const toSqlValue = (val) => {
  if (val === undefined) return null;
  if (val === '') return null; // Empty strings become NULL (important for date fields)
  if (typeof val === 'number' && isNaN(val)) return null;
  if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
    return JSON.stringify(val);
  }
  if (val instanceof Date) {
    return val.toISOString().slice(0, 19).replace('T', ' ');
  }
  return val;
};

// HELPER: Parse MySQL row to JS object
const fromSqlRow = (row) => {
  if (!row) return null;
  const res = { ...row };
  
  const jsonFields = ['active_days'];
  
  for (const key in res) {
    if (jsonFields.includes(key) && typeof res[key] === 'string') {
      try {
        res[key] = JSON.parse(res[key]);
      } catch (e) {}
    }
    
    const boolFields = [
      'receive_email_notifications', 'exclude_from_staffing_plan', 
      'user_viewed', 'auto_off', 'show_in_service_plan', 
      'allows_rotation_concurrently', 'allows_absence_overlap',
      'acknowledged', 'is_active', 'is_specialist',
      'timeslots_enabled', 'spans_midnight', 'affects_availability',
      'can_do_foreground_duty', 'can_do_background_duty', 'excluded_from_statistics',
      'is_mandatory', 'requires_certificate'
    ];
    if (boolFields.includes(key)) {
      res[key] = !!res[key];
    }
  }
  return res;
};

// HELPER: Get valid columns for entity (multi-tenant aware)
const getValidColumns = async (dbPool, tableName, cacheKey) => {
  const fullCacheKey = `${cacheKey}:${tableName}`;
  if (COLUMNS_CACHE[fullCacheKey]) return COLUMNS_CACHE[fullCacheKey];
  
  try {
    const [rows] = await dbPool.execute(`SHOW COLUMNS FROM \`${tableName}\``);
    const columns = rows.map(r => r.Field);
    COLUMNS_CACHE[fullCacheKey] = columns;
    return columns;
  } catch (e) {
    console.error(`Failed to fetch columns for ${tableName}:`, e.message);
    if (e.message.includes("doesn't exist") || e.code === 'ER_NO_SUCH_TABLE') {
      return [];
    }
    return null;
  }
};

// Cache for Workplace allows_multiple lookups (per tenant, refreshed periodically)
const WORKPLACE_CACHE = {};
const WORKPLACE_CACHE_TTL = 60_000; // 1 minute

/**
 * ShiftEntry Sentinel: Check if a position on a date already has an entry
 * when the Workplace does NOT allow multiple assignments.
 * Uses a single SELECT query — negligible performance impact.
 * 
 * @returns {object|null} The conflicting shift row, or null if no conflict
 */
const checkShiftConflict = async (dbPool, shiftData, cacheKey = 'default') => {
  const { date, position, timeslot_id } = shiftData;
  if (!date || !position) return null;

  // Look up workplace config (cached per minute)
  const wpCacheKey = `${cacheKey}:wp:${position}`;
  let wpEntry = WORKPLACE_CACHE[wpCacheKey];
  if (!wpEntry || Date.now() - wpEntry.ts > WORKPLACE_CACHE_TTL) {
    try {
      const workplaceColumns = await getValidColumns(dbPool, 'Workplace', cacheKey);
      const hasAllowsMultiple = Array.isArray(workplaceColumns) && workplaceColumns.includes('allows_multiple');
      const selectColumns = hasAllowsMultiple ? 'allows_multiple, category' : 'category';
      const [rows] = await dbPool.execute(
        `SELECT ${selectColumns} FROM Workplace WHERE name = ? LIMIT 1`,
        [position]
      );
      const wp = rows[0] || null;
      WORKPLACE_CACHE[wpCacheKey] = { data: wp, ts: Date.now() };
      wpEntry = WORKPLACE_CACHE[wpCacheKey];
    } catch (e) {
      // If Workplace table doesn't exist or query fails, skip sentinel
      console.warn('[Sentinel] Workplace lookup failed:', e.message);
      return null;
    }
  }

  const wp = wpEntry.data;
  if (!wp) return null; // Unknown position → allow

  // Determine allows_multiple (same logic as client-side)
  let allowsMultiple;
  if (wp.allows_multiple !== undefined && wp.allows_multiple !== null) {
    allowsMultiple = !!wp.allows_multiple;
  } else {
    // Category defaults
    if (wp.category === 'Rotationen') allowsMultiple = true;
    else if (wp.category === 'Dienste' || wp.category === 'Demonstrationen & Konsile') allowsMultiple = false;
    else allowsMultiple = true; // Unknown category → allow
  }

  if (allowsMultiple) return null; // Multiple allowed → no conflict

  // Check if a shift already exists for this date+position (optionally +timeslot)
  let sql, params;
  if (timeslot_id) {
    sql = 'SELECT id, doctor_id FROM ShiftEntry WHERE date = ? AND position = ? AND timeslot_id = ? LIMIT 1';
    params = [date, position, timeslot_id];
  } else {
    sql = 'SELECT id, doctor_id FROM ShiftEntry WHERE date = ? AND position = ? LIMIT 1';
    params = [date, position];
  }

  try {
    const [existing] = await dbPool.execute(sql, params);
    return existing.length > 0 ? existing[0] : null;
  } catch (e) {
    console.warn('[Sentinel] Conflict check failed:', e.message);
    return null; // On error, allow the create (don't block operations)
  }
};

const findDoctorConflicts = async (dbPool, data, excludeId = null) => {
  const name = data?.name?.trim();
  const initials = data?.initials?.trim();

  if (!name && !initials) {
    return null;
  }

  const conditions = [];
  const params = [];

  if (name) {
    conditions.push('name = ?');
    params.push(name);
  }

  if (initials) {
    conditions.push('initials = ?');
    params.push(initials);
  }

  let sql = `SELECT id, name, initials FROM Doctor WHERE (${conditions.join(' OR ')})`;
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  sql += ' LIMIT 20';

  const [rows] = await dbPool.execute(sql, params);
  const nameConflict = name ? rows.find((row) => row.name === name) : null;
  const initialsConflict = initials ? rows.find((row) => row.initials === initials) : null;

  return {
    nameConflict,
    initialsConflict,
  };
};

const buildDoctorConflictResponse = async (dbPool, data, excludeId = null) => {
  const conflicts = await findDoctorConflicts(dbPool, data, excludeId);
  if (!conflicts) {
    return null;
  }

  if (conflicts.nameConflict) {
    return {
      status: 409,
      payload: {
        error: `Ein Mitarbeiter mit dem Namen "${data.name.trim()}" existiert bereits. Bitte wählen Sie einen anderen Namen.`,
        field: 'name'
      }
    };
  }

  if (conflicts.initialsConflict) {
    return {
      status: 409,
      payload: {
        error: `Das Kürzel "${data.initials.trim()}" wird bereits verwendet. Bitte wählen Sie ein anderes Kürzel.`,
        field: 'initials'
      }
    };
  }

  return null;
};

const ensureTenantBaseSchema = async (dbPool, cacheKey) => {
  const tableCheckKey = `${cacheKey}:tenant-base-schema:checked`;
  if (COLUMNS_CACHE[tableCheckKey]) return;

  try {
    await ensureTenantBaseTables(dbPool);
    const doctorChanged = await ensureColumns(dbPool, 'Doctor', [
      ['central_employee_id', 'VARCHAR(36) DEFAULT NULL'],
    ]);
    if (doctorChanged) {
      try {
        await dbPool.execute('CREATE INDEX idx_doctor_central_employee ON Doctor(central_employee_id)');
      } catch (err) {
        if (err.code !== 'ER_DUP_KEYNAME') {
          console.warn('[dbProxy] ensureTenantBaseSchema doctor link index:', err.message);
        }
      }
    }
    clearColumnsCache(TENANT_BASE_TABLES, cacheKey);
  } catch (err) {
    console.error('Failed to ensure tenant base schema:', err.message);
    throw err;
  }

  COLUMNS_CACHE[tableCheckKey] = true;
};

const loadDoctorLink = async (dbPool, doctorId) => {
  if (!doctorId) return null;
  const [rows] = await dbPool.execute(
    'SELECT id, central_employee_id FROM Doctor WHERE id = ? LIMIT 1',
    [doctorId]
  );
  if (rows.length === 0 || !rows[0].central_employee_id) {
    return null;
  }
  return {
    doctorId: String(rows[0].id),
    employeeId: String(rows[0].central_employee_id),
  };
};

const resolveCentralShiftRouting = async ({ dbPool, masterDb, req, tableName, action, id, data }) => {
  if (tableName !== 'ShiftEntry') return null;

  const tenantId = req.dbToken ? await resolveTenantIdFromToken(masterDb, req.dbToken) : null;

  if (['list', 'filter'].includes(action)) {
    return { tenantId };
  }

  if (action === 'create') {
    const doctorLink = await loadDoctorLink(dbPool, data?.doctor_id);
    if (doctorLink && isCentralAbsencePosition(data?.position)) {
      return { tenantId, doctorLink, mode: 'central' };
    }
    return { tenantId, doctorLink, mode: 'tenant' };
  }

  if (action === 'bulkCreate') {
    return { tenantId };
  }

  if (action === 'get' || action === 'delete' || action === 'update') {
    const existing = await getShiftEntryWithCentralAbsence({ tenantDb: dbPool, masterDb, id });
    if (!existing) {
      return { tenantId, existing: null, mode: 'tenant' };
    }
    const doctorLink = await loadDoctorLink(dbPool, existing.doctor_id);
    const isCentral = !!doctorLink && isCentralAbsencePosition(existing.position);
    return { tenantId, existing, doctorLink, mode: isCentral ? 'central' : 'tenant' };
  }

  return { tenantId };
};

// Handle GET requests with helpful error
router.get('/', (req, res) => {
  res.status(405).json({ 
    error: 'Method not allowed. Use POST with { action, entity, ... }',
    hint: 'GET requests are not supported on /api/db'
  });
});

// Auto-create ScheduleBlock table if it doesn't exist (for multi-tenant support)
const ensureScheduleBlockTable = async (dbPool, cacheKey) => {
  const tableCheckKey = `${cacheKey}:ScheduleBlock:checked`;
  if (COLUMNS_CACHE[tableCheckKey]) return;
  
  try {
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
    COLUMNS_CACHE[tableCheckKey] = true;
  } catch (err) {
    console.warn('ensureScheduleBlockTable error:', err.message);
  }
};

// Auto-create TeamRole table if it doesn't exist (for multi-tenant support)
const ensureTeamRoleTable = async (dbPool, cacheKey) => {
  const tableCheckKey = `${cacheKey}:TeamRole:checked`;
  if (COLUMNS_CACHE[tableCheckKey]) return; // Already checked this session
  
  try {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS TeamRole (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        priority INT NOT NULL DEFAULT 99,
        is_specialist BOOLEAN NOT NULL DEFAULT FALSE,
        can_do_foreground_duty BOOLEAN NOT NULL DEFAULT TRUE,
        can_do_background_duty BOOLEAN NOT NULL DEFAULT FALSE,
        excluded_from_statistics BOOLEAN NOT NULL DEFAULT FALSE,
        description VARCHAR(255) DEFAULT NULL,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    // Add new columns if table exists but lacks them (migration)
    try {
      await ensureColumns(dbPool, 'TeamRole', [
        ['can_do_foreground_duty', 'BOOLEAN NOT NULL DEFAULT TRUE'],
        ['can_do_background_duty', 'BOOLEAN NOT NULL DEFAULT FALSE'],
        ['excluded_from_statistics', 'BOOLEAN NOT NULL DEFAULT FALSE'],
        ['description', 'VARCHAR(255) DEFAULT NULL'],
      ]);
    } catch (alterErr) {
      // Columns might already exist
    }

    // Fix for existing tenants: ALTER TABLE sets can_do_background_duty=FALSE for all rows.
    // Update known roles to correct values if they still have the wrong defaults.
    try {
      await dbPool.execute(`UPDATE TeamRole SET can_do_background_duty = TRUE WHERE name IN ('Chefarzt', 'Oberarzt', 'Facharzt') AND can_do_background_duty = FALSE`);
      await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = FALSE WHERE name IN ('Chefarzt', 'Oberarzt', 'Nicht-Radiologe') AND can_do_foreground_duty = TRUE AND is_specialist = TRUE`);
      await dbPool.execute(`UPDATE TeamRole SET can_do_foreground_duty = FALSE WHERE name = 'Nicht-Radiologe' AND can_do_foreground_duty = TRUE`);
      await dbPool.execute(`UPDATE TeamRole SET excluded_from_statistics = TRUE WHERE name = 'Nicht-Radiologe' AND excluded_from_statistics = FALSE`);
    } catch (updateErr) {
      console.warn('TeamRole defaults migration update skipped:', updateErr.message);
    }

    // Seed defaults if empty
    const [existing] = await dbPool.execute('SELECT COUNT(*) as cnt FROM TeamRole');
    if (existing[0].cnt === 0) {
      const defaultRoles = [
        { name: 'Chefarzt', priority: 0, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: 'Oberste Führungsebene' },
        { name: 'Oberarzt', priority: 1, is_specialist: true, can_do_foreground_duty: false, can_do_background_duty: true, excluded_from_statistics: false, description: 'Kann Hintergrunddienste übernehmen' },
        { name: 'Facharzt', priority: 2, is_specialist: true, can_do_foreground_duty: true, can_do_background_duty: true, excluded_from_statistics: false, description: 'Kann alle Dienste übernehmen' },
        { name: 'Assistenzarzt', priority: 3, is_specialist: false, can_do_foreground_duty: true, can_do_background_duty: false, excluded_from_statistics: false, description: 'Kann Vordergrunddienste übernehmen' },
        { name: 'Nicht-Radiologe', priority: 4, is_specialist: false, can_do_foreground_duty: false, can_do_background_duty: false, excluded_from_statistics: true, description: 'Wird in Statistiken nicht gezählt' },
      ];
      for (const role of defaultRoles) {
        const id = crypto.randomUUID();
        await dbPool.execute(
          'INSERT IGNORE INTO TeamRole (id, name, priority, is_specialist, can_do_foreground_duty, can_do_background_duty, excluded_from_statistics, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, role.name, role.priority, role.is_specialist, role.can_do_foreground_duty, role.can_do_background_duty, role.excluded_from_statistics, role.description]
        );
      }
      console.log('✅ TeamRole table created and seeded for tenant');
    }
    COLUMNS_CACHE[tableCheckKey] = true;
  } catch (err) {
    console.error('Failed to ensure TeamRole table:', err.message);
    COLUMNS_CACHE[tableCheckKey] = true; // Don't retry on error
  }
};

// Auto-create Qualification tables if they don't exist (for multi-tenant support)
const ensureQualificationTables = async (dbPool, cacheKey) => {
  const tableCheckKey = `${cacheKey}:Qualification:checked`;
  if (COLUMNS_CACHE[tableCheckKey]) return;
  
  try {
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS Qualification (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        short_label VARCHAR(10) DEFAULT NULL,
        description VARCHAR(255) DEFAULT NULL,
        color_bg VARCHAR(20) DEFAULT '#e0e7ff',
        color_text VARCHAR(20) DEFAULT '#3730a3',
        category VARCHAR(50) DEFAULT 'Allgemein',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        requires_certificate BOOLEAN NOT NULL DEFAULT FALSE,
        certificate_requirement_mode VARCHAR(32) DEFAULT 'single_document',
        certificate_validity_months INT DEFAULT NULL,
        certificate_refresh_validity_months INT DEFAULT NULL,
        certificate_base_label VARCHAR(100) DEFAULT 'Grundnachweis',
        certificate_refresh_label VARCHAR(100) DEFAULT 'Verlängerung / Auffrischung',
        \`order\` INT NOT NULL DEFAULT 99,
        created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT 'system'
      )
    `);
    
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS DoctorQualification (
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
        created_by VARCHAR(255) DEFAULT 'system',
        UNIQUE KEY uq_doctor_qual (doctor_id, qualification_id),
        INDEX idx_dq_doctor (doctor_id),
        INDEX idx_dq_qualification (qualification_id)
      )
    `);
    
    await dbPool.execute(`
      CREATE TABLE IF NOT EXISTS WorkplaceQualification (
        id VARCHAR(255) PRIMARY KEY,
        workplace_id VARCHAR(255) NOT NULL,
        qualification_id VARCHAR(255) NOT NULL,
        is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
        is_excluded BOOLEAN NOT NULL DEFAULT FALSE,
        created_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
        updated_date DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        created_by VARCHAR(255) DEFAULT 'system',
        UNIQUE KEY uq_workplace_qual (workplace_id, qualification_id),
        INDEX idx_wq_workplace (workplace_id),
        INDEX idx_wq_qualification (qualification_id)
      )
    `);

    // Add is_excluded column if table already existed without it
    try {
      const changed = await Promise.all([
        ensureColumns(dbPool, 'WorkplaceQualification', [
          ['is_excluded', 'BOOLEAN NOT NULL DEFAULT FALSE'],
        ]),
        ensureColumns(dbPool, 'Qualification', [
          ['requires_certificate', 'BOOLEAN NOT NULL DEFAULT FALSE'],
          ['certificate_requirement_mode', "VARCHAR(32) DEFAULT 'single_document'"],
          ['certificate_validity_months', 'INT DEFAULT NULL'],
          ['certificate_refresh_validity_months', 'INT DEFAULT NULL'],
          ['certificate_base_label', "VARCHAR(100) DEFAULT 'Grundnachweis'"],
          ['certificate_refresh_label', "VARCHAR(100) DEFAULT 'Verlängerung / Auffrischung'"],
        ]),
        ensureColumns(dbPool, 'DoctorQualification', [
          ['certificate_status', 'VARCHAR(32) DEFAULT NULL'],
          ['certificate_valid_from', 'DATE DEFAULT NULL'],
          ['certificate_valid_until', 'DATE DEFAULT NULL'],
          ['certificate_status_reason', 'VARCHAR(500) DEFAULT NULL'],
        ]),
      ]);

      if (changed.some(Boolean)) {
        clearColumnsCache(['WorkplaceQualification', 'Qualification', 'DoctorQualification'], cacheKey);
      }
    } catch (alterErr) {
      // Column might already exist
    }
    
    COLUMNS_CACHE[tableCheckKey] = true;
    console.log('✅ Qualification tables ensured for tenant');
  } catch (err) {
    console.error('Failed to ensure Qualification tables:', err.message);
    COLUMNS_CACHE[tableCheckKey] = true;
  }
};

// Auto-add min_staff and optimal_staff columns to Workplace if missing (for auto-fill engine)
const ensureWorkplaceStaffColumns = async (dbPool, cacheKey) => {
  const checkKey = `${cacheKey}:Workplace:staff_cols_checked`;
  if (COLUMNS_CACHE[checkKey]) return;

  try {
    const changed = await ensureColumns(dbPool, 'Workplace', [
      ['min_staff', 'INT DEFAULT 1'],
      ['optimal_staff', 'INT DEFAULT 1'],
      ['consecutive_days_mode', "VARCHAR(20) DEFAULT 'allowed'"],
    ]);

    // Migrate legacy boolean values if the new column was just added
    await dbPool.execute(`UPDATE Workplace SET consecutive_days_mode = 'forbidden' WHERE consecutive_days_mode = 'allowed' AND allows_consecutive_days = 0`).catch(() => {});
    if (changed) {
      clearColumnsCache(['Workplace'], cacheKey);
    }
  } catch (err) {
    // Columns might already exist or table might not exist yet — both are fine
    if (err.code !== 'ER_DUP_FIELDNAME') {
      console.warn('[dbProxy] ensureWorkplaceStaffColumns:', err.message);
    }
  }
  COLUMNS_CACHE[checkKey] = true;
};

// ============ AUDIT LOG HELPER ============
// Writes an audit entry to the SystemLog table for UI visibility
export const writeAuditLog = async (dbPool, { level = 'audit', source, message, details, userEmail }) => {
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await dbPool.execute(
      `INSERT INTO SystemLog (id, level, source, message, details, created_date, updated_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, level, source, message, typeof details === 'string' ? details : JSON.stringify(details), now, now, userEmail || 'system']
    );
  } catch (err) {
    // Don't let audit logging failures break the main operation
    console.error('[AUDIT] Failed to write audit log to SystemLog table:', err.message);
  }
};

// ============ UNIFIED DB PROXY ENDPOINT ============
router.post('/', async (req, res, next) => {
  try {
    const { action, operation, entity, table, data, id, query, sort, limit, skip } = req.body;
    const effectiveAction = action || operation; // Support both 'action' and 'operation' keys
    const tableName = entity || table;
    
    // Get the database pool (set by tenantDbMiddleware)
    const dbPool = req.db || db;
    const cacheKey = req.headers['x-db-token'] || 'default';
    const realtimeScope = buildRealtimeScope(req.dbToken);
    const actor = {
      id: req.user?.sub || null,
      email: req.user?.email || 'system',
    };

    if (req.isCustomDb && tableName && TENANT_BASE_TABLE_SET.has(tableName)) {
      await ensureTenantBaseSchema(dbPool, cacheKey);
    }
    
    // Auto-create TeamRole table for tenants if needed
    if (tableName === 'TeamRole') {
      await ensureTeamRoleTable(dbPool, cacheKey);
    }
    
    // Auto-create Qualification tables for tenants if needed
    if (['Qualification', 'DoctorQualification', 'WorkplaceQualification'].includes(tableName)) {
      await ensureQualificationTables(dbPool, cacheKey);
    }
    
    // Auto-add min_staff/optimal_staff columns to Workplace if needed
    if (tableName === 'Workplace') {
      await ensureWorkplaceStaffColumns(dbPool, cacheKey);
    }

    // Auto-create ScheduleBlock table for tenants if needed
    if (tableName === 'ScheduleBlock') {
      await ensureScheduleBlockTable(dbPool, cacheKey);
    }
    
    if (!tableName) {
      return res.status(400).json({ error: 'Entity/table required' });
    }
    
    if (!effectiveAction) {
      return res.status(400).json({ error: 'Action/operation required' });
    }
    
    // Check if this is a public read operation
    const isPublicRead = PUBLIC_READ_TABLES.includes(tableName) && 
                         (effectiveAction === 'list' || effectiveAction === 'filter' || effectiveAction === 'get');
    
    // Require auth for non-public operations
    if (!isPublicRead) {
      // Check for auth token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Nicht autorisiert' });
      }
      
      // Verify token (inline check)
      const token = authHeader.split(' ')[1];
      try {
        const jwt = await import('jsonwebtoken');
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Set user from token
      } catch (err) {
        return res.status(401).json({ error: 'Token ungültig' });
      }
    }
    
    // ===== LIST / FILTER =====
    if (effectiveAction === 'list' || effectiveAction === 'filter') {
      if (tableName === 'ShiftEntry' && req.db) {
        const rows = await listShiftEntriesWithCentralAbsences({
          tenantDb: dbPool,
          masterDb: db,
          filters: query || req.body.filters || {},
          sort,
          limit,
          skip,
        });
        return res.json(rows);
      }

      let sql = `SELECT * FROM \`${tableName}\``;
      const params = [];
      
      const filters = query || req.body.filters || {};
      
      if (filters && Object.keys(filters).length > 0) {
        const clauses = [];
        for (const [key, val] of Object.entries(filters)) {
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            if (val.$gte !== undefined) {
              clauses.push(`\`${key}\` >= ?`);
              params.push(toSqlValue(val.$gte));
            }
            if (val.$lte !== undefined) {
              clauses.push(`\`${key}\` <= ?`);
              params.push(toSqlValue(val.$lte));
            }
          } else {
            clauses.push(`\`${key}\` = ?`);
            params.push(toSqlValue(val));
          }
        }
        if (clauses.length > 0) {
          sql += ` WHERE ${clauses.join(' AND ')}`;
        }
      }
      
      if (sort) {
        if (typeof sort === 'string') {
          const desc = sort.startsWith('-');
          const field = desc ? sort.substring(1) : sort;
          sql += ` ORDER BY \`${field}\` ${desc ? 'DESC' : 'ASC'}`;
          
          if (field !== 'id') {
            sql += `, \`id\` ASC`;
          }
        }
      } else {
        sql += ` ORDER BY \`id\` ASC`;
      }
      
      if (limit && !isNaN(parseInt(limit))) {
        sql += ` LIMIT ${parseInt(limit)}`;
        if (skip && !isNaN(parseInt(skip))) {
          sql += ` OFFSET ${parseInt(skip)}`;
        }
      }
      
      try {
        const safeParams = params.map(p => p === undefined ? null : p);
        const [rows] = await dbPool.execute(sql, safeParams);
        return res.json(rows.map(fromSqlRow));
      } catch (err) {
        console.error("List Execute Error:", err.message, "SQL:", sql);
        if (err.message.includes("doesn't exist") || err.code === 'ER_NO_SUCH_TABLE') {
          console.warn(`Table ${tableName} doesn't exist, returning empty array`);
          return res.json([]);
        }
        throw err;
      }
    }
    
    // ===== GET =====
    if (effectiveAction === 'get') {
      if (!id) return res.json(null);

      if (tableName === 'ShiftEntry' && req.db) {
        const record = await getShiftEntryWithCentralAbsence({ tenantDb: dbPool, masterDb: db, id });
        return res.json(record);
      }
      
      const [rows] = await dbPool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [id]);
      return res.json(rows[0] ? fromSqlRow(rows[0]) : null);
    }
    
    // ===== CREATE =====
    if (effectiveAction === 'create') {
      const centralRouting = await resolveCentralShiftRouting({
        dbPool,
        masterDb: db,
        req,
        tableName,
        action: effectiveAction,
        data,
      });

      if (!data.id) data.id = crypto.randomUUID();
      data.created_date = new Date();
      data.updated_date = new Date();
      data.created_by = req.user?.email || 'system';

      if (tableName === 'ShiftEntry' && req.db && centralRouting?.mode === 'central') {
        const created = await writeShiftEntryToCentralAbsence({
          tenantDb: dbPool,
          masterDb: db,
          tenantId: centralRouting.tenantId,
          shiftEntry: data,
          doctorId: centralRouting.doctorLink.doctorId,
          preserveId: true,
        });
        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({
            scope: realtimeScope,
            entity: tableName,
            action: 'create',
            recordId: created?.id || data.id,
            actor,
          });
        }
        return res.json(created || data);
      }

      if (tableName === 'Doctor') {
        const conflictResponse = await buildDoctorConflictResponse(dbPool, data);
        if (conflictResponse) {
          return res.status(conflictResponse.status).json(conflictResponse.payload);
        }
      }
      
      // --- ShiftEntry Sentinel: prevent duplicates for single-assignment positions ---
      if (tableName === 'ShiftEntry' && data.date && data.position) {
        // Check ScheduleBlock first (ensure table exists for tenant DBs)
        await ensureScheduleBlockTable(dbPool, cacheKey);
        try {
          let blockSql, blockParams;
          if (data.timeslot_id) {
            blockSql = 'SELECT id, reason FROM ScheduleBlock WHERE date = ? AND position = ? AND (timeslot_id = ? OR timeslot_id IS NULL) LIMIT 1';
            blockParams = [data.date, data.position, data.timeslot_id];
          } else {
            blockSql = 'SELECT id, reason FROM ScheduleBlock WHERE date = ? AND position = ? AND timeslot_id IS NULL LIMIT 1';
            blockParams = [data.date, data.position];
          }
          const [blockRows] = await dbPool.execute(blockSql, blockParams);
          if (blockRows.length > 0) {
            console.warn(`[Sentinel] Blocked ShiftEntry on locked cell: ${data.position} on ${data.date} (reason: ${blockRows[0].reason})`);
            return res.status(409).json({
              error: 'Zelle gesperrt' + (blockRows[0].reason ? `: ${blockRows[0].reason}` : ''),
              blocked: true,
              block_id: blockRows[0].id,
              reason: blockRows[0].reason
            });
          }
        } catch (e) {
          // ScheduleBlock table may not exist yet — skip silently
        }

        const conflict = await checkShiftConflict(dbPool, data, cacheKey);
        if (conflict) {
          console.warn(`[Sentinel] Blocked duplicate ShiftEntry: ${data.position} on ${data.date} (existing: ${conflict.id})`);
          return res.status(409).json({ 
            error: 'Position bereits besetzt',
            conflict: true,
            existing_id: conflict.id,
            existing_doctor_id: conflict.doctor_id
          });
        }
      }
      
      // --- ShiftEntry Auto-Time: calculate start_time/end_time from ShiftTimeRule ---
      if (tableName === 'ShiftEntry' && data.doctor_id && data.position && !data.start_time) {
        try {
          // 1. Get doctor's work_time_model_id
          const [docRows] = await dbPool.execute(
            `SELECT work_time_model_id FROM Doctor WHERE id = ? LIMIT 1`,
            [data.doctor_id]
          );
          const modelId = docRows[0]?.work_time_model_id;
          
          if (modelId) {
            // 2. Find workplace_id by position name
            const [wpRows] = await dbPool.execute(
              `SELECT id FROM Workplace WHERE name = ? LIMIT 1`,
              [data.position]
            );
            const workplaceId = wpRows[0]?.id;
            
            if (workplaceId) {
              // 3. Look up ShiftTimeRule for this workplace + model
              const [ruleRows] = await dbPool.execute(
                `SELECT start_time, end_time, break_minutes FROM ShiftTimeRule WHERE workplace_id = ? AND work_time_model_id = ? LIMIT 1`,
                [workplaceId, modelId]
              );
              
              if (ruleRows[0]) {
                data.start_time = ruleRows[0].start_time;
                data.end_time = ruleRows[0].end_time;
                if (ruleRows[0].break_minutes) {
                  data.break_minutes = ruleRows[0].break_minutes;
                }
              }
            }
          }
        } catch (e) {
          // Non-critical: if auto-time fails, create shift without times
          console.warn(`[AutoTime] Failed to calculate shift times: ${e.message}`);
        }
      }
      
      const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
      let keys = Object.keys(data);
      
      if (validColumns && validColumns.length > 0) {
        keys = keys.filter(k => validColumns.includes(k));
      }
      
      if (keys.length === 0) {
        console.error(`CREATE failed: No valid columns for ${tableName}. Data keys:`, Object.keys(data), "Valid columns:", validColumns);
        return res.status(500).json({ error: `No valid columns found for table ${tableName}` });
      }
      
      const values = keys.map(k => toSqlValue(data[k]));
      const placeholders = keys.map(() => '?').join(',');
      const sql = `INSERT INTO \`${tableName}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`;
      
      try {
        const safeValues = values.map(v => v === undefined ? null : v);
        await dbPool.execute(sql, safeValues);
        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({
            scope: realtimeScope,
            entity: tableName,
            action: 'create',
            recordId: data.id,
            actor,
          });
        }
        return res.json(data);
      } catch (err) {
        console.error(`CREATE error for ${tableName}:`, err.message, "SQL:", sql);
        if (tableName === 'Doctor' && err.code === 'ER_DUP_ENTRY') {
          const conflictResponse = await buildDoctorConflictResponse(dbPool, data);
          if (conflictResponse) {
            return res.status(conflictResponse.status).json(conflictResponse.payload);
          }
        }
        throw err;
      }
    }
    
    // ===== UPDATE =====
    if (effectiveAction === 'update') {
      if (!id) return res.status(400).json({ error: "ID required for update" });

      const centralRouting = await resolveCentralShiftRouting({
        dbPool,
        masterDb: db,
        req,
        tableName,
        action: effectiveAction,
        id,
      });
      
      data.updated_date = new Date();

      if (tableName === 'ShiftEntry' && req.db && centralRouting?.existing) {
        const nextDoctorId = data.doctor_id || centralRouting.existing.doctor_id;
        const nextDoctorLink = await loadDoctorLink(dbPool, nextDoctorId);
        const nextPosition = data.position || centralRouting.existing.position;
        const nextPayload = { ...centralRouting.existing, ...data, id, doctor_id: nextDoctorId };

        if (nextDoctorLink && isCentralAbsencePosition(nextPosition)) {
          if (centralRouting.mode !== 'central') {
            await dbPool.execute('DELETE FROM ShiftEntry WHERE id = ?', [id]);
          }
          const updated = await writeShiftEntryToCentralAbsence({
            tenantDb: dbPool,
            masterDb: db,
            tenantId: centralRouting.tenantId,
            shiftEntry: nextPayload,
            doctorId: nextDoctorLink.doctorId,
            preserveId: true,
          });
          if (isPlanSyncEntity(tableName)) {
            broadcastPlanUpdate({
              scope: realtimeScope,
              entity: tableName,
              action: 'update',
              recordId: id,
              actor,
            });
          }
          return res.json(updated);
        }

        if (centralRouting.mode === 'central') {
          await deleteCentralAbsenceById(db, id);
          const localPayload = { ...nextPayload, doctor_id: nextDoctorId };
          const keys = Object.keys(localPayload).filter((key) => key !== 'id');
          const values = keys.map((key) => toSqlValue(localPayload[key]));
          await dbPool.execute(
            `INSERT INTO \`ShiftEntry\` (\`id\`, ${keys.map((key) => `\`${key}\``).join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`,
            [id, ...values]
          );
          const [rows] = await dbPool.execute('SELECT * FROM `ShiftEntry` WHERE id = ?', [id]);
          if (isPlanSyncEntity(tableName)) {
            broadcastPlanUpdate({
              scope: realtimeScope,
              entity: tableName,
              action: 'update',
              recordId: id,
              actor,
            });
          }
          return res.json(rows[0] ? fromSqlRow(rows[0]) : null);
        }
      }

      if (tableName === 'Doctor') {
        const conflictResponse = await buildDoctorConflictResponse(dbPool, data, id);
        if (conflictResponse) {
          return res.status(conflictResponse.status).json(conflictResponse.payload);
        }
      }
      
      const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
      let keys = Object.keys(data).filter(k => k !== 'id');
      
      if (validColumns) {
        keys = keys.filter(k => validColumns.includes(k));
      }
      
      if (keys.length === 0) return res.json({ success: true });
      
      const sets = keys.map(k => `\`${k}\` = ?`).join(',');
      const values = keys.map(k => toSqlValue(data[k]));
      values.push(id);
      
      const sql = `UPDATE \`${tableName}\` SET ${sets} WHERE id = ?`;
      const safeValues = values.map(v => v === undefined ? null : v);
      try {
        await dbPool.execute(sql, safeValues);
      } catch (err) {
        if (tableName === 'Doctor' && err.code === 'ER_DUP_ENTRY') {
          const conflictResponse = await buildDoctorConflictResponse(dbPool, data, id);
          if (conflictResponse) {
            return res.status(conflictResponse.status).json(conflictResponse.payload);
          }
        }
        throw err;
      }
      
      const [rows] = await dbPool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [id]);
      if (isPlanSyncEntity(tableName)) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: tableName,
          action: 'update',
          recordId: id,
          actor,
        });
      }
      return res.json(rows[0] ? fromSqlRow(rows[0]) : null);
    }
    
    // ===== DELETE =====
    if (effectiveAction === 'delete') {
      if (!id) return res.status(400).json({ error: "ID required for delete" });

      if (tableName === 'ShiftEntry' && req.db) {
        const centralRouting = await resolveCentralShiftRouting({
          dbPool,
          masterDb: db,
          req,
          tableName,
          action: effectiveAction,
          id,
        });
        if (centralRouting?.mode === 'central') {
          await deleteCentralAbsenceById(db, id);
          if (isPlanSyncEntity(tableName)) {
            broadcastPlanUpdate({
              scope: realtimeScope,
              entity: tableName,
              action: 'delete',
              recordId: id,
              actor,
            });
          }
          return res.json({ success: true });
        }
      }
      
      // Fetch record before deletion for logging
      const [existingRows] = await dbPool.execute(`SELECT * FROM \`${tableName}\` WHERE id = ?`, [id]);
      const deletedRecord = existingRows[0] ? fromSqlRow(existingRows[0]) : null;
      
      await dbPool.execute(`DELETE FROM \`${tableName}\` WHERE id = ?`, [id]);
      
      // Write audit to SystemLog table
      const userEmail = req.user?.email || 'unknown';
      const timestamp = new Date().toISOString();
      await writeAuditLog(dbPool, {
        level: 'audit',
        source: 'Löschung',
        message: `${tableName} gelöscht von ${userEmail} (ID: ${id})`,
        details: { table: tableName, record_id: id, deleted_data: deletedRecord, timestamp },
        userEmail
      });

      if (isPlanSyncEntity(tableName)) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: tableName,
          action: 'delete',
          recordId: id,
          actor,
        });
      }
      
      return res.json({ success: true });
    }
    
    // ===== BULK CREATE =====
    if (effectiveAction === 'bulkCreate') {
      if (!Array.isArray(data) || data.length === 0) return res.json([]);

      if (tableName === 'ShiftEntry' && req.db) {
        const tenantId = req.dbToken ? await resolveTenantIdFromToken(db, req.dbToken) : null;
        const createdRows = [];
        const localRows = [];

        for (const item of data) {
          const doctorLink = await loadDoctorLink(dbPool, item.doctor_id);
          if (doctorLink && isCentralAbsencePosition(item.position)) {
            const prepared = {
              ...item,
              id: item.id || crypto.randomUUID(),
              created_date: item.created_date || new Date(),
              updated_date: item.updated_date || new Date(),
              created_by: item.created_by || req.user?.email || 'system',
            };
            const created = await writeShiftEntryToCentralAbsence({
              tenantDb: dbPool,
              masterDb: db,
              tenantId,
              shiftEntry: prepared,
              doctorId: doctorLink.doctorId,
              preserveId: true,
            });
            createdRows.push(created || prepared);
          } else {
            localRows.push(item);
          }
        }

        if (localRows.length > 0) {
          const processed = localRows.map((item) => ({
            ...item,
            id: item.id || crypto.randomUUID(),
            created_date: item.created_date || new Date(),
            updated_date: item.updated_date || new Date(),
            created_by: item.created_by || req.user?.email || 'system',
          }));
          const allKeys = new Set();
          processed.forEach((item) => Object.keys(item).forEach((key) => allKeys.add(key)));
          const keys = Array.from(allKeys);
          const bulkConn = await dbPool.getConnection();
          try {
            await bulkConn.beginTransaction();
            for (const item of processed) {
              const values = keys.map((key) => toSqlValue(item[key]));
              await bulkConn.execute(
                `INSERT INTO \`ShiftEntry\` (\`${keys.join('`,`')}\`) VALUES (${keys.map(() => '?').join(',')})`,
                values
              );
            }
            await bulkConn.commit();
          } catch (bulkErr) {
            try { await bulkConn.rollback(); } catch (rollbackErr) {
              console.error('[DB Proxy] bulkCreate rollback failed:', rollbackErr.message);
            }
            throw bulkErr;
          } finally {
            bulkConn.release();
          }
          createdRows.push(...processed);
        }

        if (isPlanSyncEntity(tableName)) {
          broadcastPlanUpdate({
            scope: realtimeScope,
            entity: tableName,
            action: 'bulkCreate',
            recordCount: createdRows.length,
            actor,
          });
        }
        return res.json(createdRows);
      }
      
      const processed = data.map(item => {
        if (!item.id) item.id = crypto.randomUUID();
        item.created_date = new Date();
        item.updated_date = new Date();
        item.created_by = req.user?.email || 'system';
        return item;
      });
      
      // --- ShiftEntry Sentinel for bulk creates ---
      if (tableName === 'ShiftEntry') {
        const filtered = [];
        for (const item of processed) {
          if (item.date && item.position) {
            const conflict = await checkShiftConflict(dbPool, item, cacheKey);
            if (conflict) {
              console.warn(`[Sentinel] Blocked duplicate in bulkCreate: ${item.position} on ${item.date}`);
              continue; // Skip this item silently
            }
          }
          filtered.push(item);
        }
        if (filtered.length === 0) return res.json([]);
        processed.length = 0;
        processed.push(...filtered);

        // --- Auto-Time for bulk creates ---
        for (const item of processed) {
          if (item.doctor_id && item.position && !item.start_time) {
            try {
              const [docRows] = await dbPool.execute(
                `SELECT work_time_model_id FROM Doctor WHERE id = ? LIMIT 1`,
                [item.doctor_id]
              );
              const modelId = docRows[0]?.work_time_model_id;
              if (modelId) {
                const [wpRows] = await dbPool.execute(
                  `SELECT id FROM Workplace WHERE name = ? LIMIT 1`,
                  [item.position]
                );
                const workplaceId = wpRows[0]?.id;
                if (workplaceId) {
                  const [ruleRows] = await dbPool.execute(
                    `SELECT start_time, end_time, break_minutes FROM ShiftTimeRule WHERE workplace_id = ? AND work_time_model_id = ? LIMIT 1`,
                    [workplaceId, modelId]
                  );
                  if (ruleRows[0]) {
                    item.start_time = ruleRows[0].start_time;
                    item.end_time = ruleRows[0].end_time;
                    if (ruleRows[0].break_minutes) item.break_minutes = ruleRows[0].break_minutes;
                  }
                }
              }
            } catch (e) {
              console.warn(`[AutoTime] Bulk: Failed for ${item.position}: ${e.message}`);
            }
          }
        }
      }
      
      const allKeys = new Set();
      processed.forEach(item => Object.keys(item).forEach(k => allKeys.add(k)));
      
      let keys = Array.from(allKeys);
      
      const validColumns = await getValidColumns(dbPool, tableName, cacheKey);
      if (validColumns) {
        keys = keys.filter(k => validColumns.includes(k));
      }
      
      if (keys.length === 0) {
        return res.status(400).json({ error: "No valid columns found for insert" });
      }

      // Insert each item individually inside a transaction so that a mid-batch
      // failure leaves no partial data. This prevents the UI from rolling back
      // an optimistic update while the server has already persisted some rows.
      const bulkConn = await dbPool.getConnection();
      try {
        await bulkConn.beginTransaction();
        for (const item of processed) {
          const values = keys.map(k => toSqlValue(item[k]));
          const placeholders = keys.map(() => '?').join(',');
          const sql = `INSERT INTO \`${tableName}\` (\`${keys.join('`,`')}\`) VALUES (${placeholders})`;
          const safeValues = values.map(v => v === undefined ? null : v);
          await bulkConn.execute(sql, safeValues);
        }
        await bulkConn.commit();
      } catch (bulkErr) {
        try { await bulkConn.rollback(); } catch (rollbackErr) {
          console.error('[DB Proxy] bulkCreate rollback failed:', rollbackErr.message);
        }
        throw bulkErr;
      } finally {
        bulkConn.release();
      }

      if (isPlanSyncEntity(tableName)) {
        broadcastPlanUpdate({
          scope: realtimeScope,
          entity: tableName,
          action: 'bulkCreate',
          recordCount: processed.length,
          actor,
        });
      }
      
      return res.json(processed);
    }
    
    return res.status(400).json({ error: 'Unknown action' });
    
  } catch (error) {
    console.error("DB Proxy Error:", error.message, "Stack:", error.stack);
    console.error("Request body:", JSON.stringify(req.body || {}).substring(0, 500));
    
    // If this is an access denied error and we have a custom DB token, remove it from cache
    if ((error.code === 'ER_ACCESS_DENIED_ERROR' || error.code === 'ER_DBACCESS_DENIED_ERROR') && req.dbToken) {
      console.log("Removing invalid tenant pool from cache due to access denied error");
      removeTenantPool(req.dbToken);
    }
    
    next(error);
  }
});

export default router;
