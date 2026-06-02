import crypto from 'crypto';

// Canonical PascalCase spellings used by the central absence storage.
export const CENTRAL_ABSENCE_POSITIONS = new Set([
  'Urlaub',
  'Krank',
  'Frei',
  'Dienstreise',
  'Nicht verfügbar',
  'Fortbildung',
  'Kongress',
  'Elternzeit',
  'Mutterschutz',
]);

// Lowercase, umlaut-stripped spellings the tenant UI also treats as
// absences. Both spellings are persisted in the wild (PascalCase from
// newer writes, lowercase from older data and the `normalizeShiftPosition`
// helper in src/utils/shiftPositionUtils.js). Normalize at the boundary so
// migration and read-merge handle both consistently.
const CENTRAL_ABSENCE_POSITIONS_NORMALIZED = new Set([
  'urlaub',
  'krank',
  'frei',
  'dienstreise',
  'nicht verfügbar',
  'nicht verfuegbar',
  'fortbildung',
  'kongress',
  'elternzeit',
  'mutterschutz',
]);

const normalizeShiftPosition = (position) => {
  if (position === null || position === undefined) return '';
  return String(position)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
};

const CENTRAL_ABSENCE_COLUMNS = [
  'id',
  'employee_id',
  'date',
  'position',
  'note',
  'start_time',
  'end_time',
  'break_minutes',
  'timeslot_id',
  'order',
  'created_date',
  'updated_date',
  'created_by',
  'source_tenant_id',
  'source_tenant_doctor_id',
];

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

// Ensures the CentralAbsenceEntry table is created at most once per process.
// The table is also created by the startup master migration; this flag avoids
// running CREATE TABLE IF NOT EXISTS on every ShiftEntry read.
let centralAbsenceTableEnsured = false;

const toDateString = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

const fromSqlRow = (row) => {
  if (!row) return null;
  return {
    ...row,
    date: toDateString(row.date),
    created_date: row.created_date instanceof Date ? row.created_date.toISOString() : row.created_date,
    updated_date: row.updated_date instanceof Date ? row.updated_date.toISOString() : row.updated_date,
  };
};

const buildWhereClause = (filters = {}) => {
  const clauses = [];
  const params = [];

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (hasOwn(value, '$gte')) {
        clauses.push(`\`${key}\` >= ?`);
        params.push(value.$gte);
      }
      if (hasOwn(value, '$lte')) {
        clauses.push(`\`${key}\` <= ?`);
        params.push(value.$lte);
      }
      continue;
    }

    clauses.push(`\`${key}\` = ?`);
    params.push(value);
  }

  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
};

const buildOrderClause = (sort) => {
  if (!sort || typeof sort !== 'string') {
    return ' ORDER BY `id` ASC';
  }

  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  const direction = desc ? 'DESC' : 'ASC';
  return field === 'id'
    ? ` ORDER BY \`${field}\` ${direction}`
    : ` ORDER BY \`${field}\` ${direction}, \`id\` ASC`;
};

const buildLimitClause = (limit, skip) => {
  if (!limit || Number.isNaN(Number.parseInt(limit, 10))) {
    return '';
  }

  const parsedLimit = Number.parseInt(limit, 10);
  const parsedSkip = skip && !Number.isNaN(Number.parseInt(skip, 10)) ? Number.parseInt(skip, 10) : null;
  return parsedSkip === null ? ` LIMIT ${parsedLimit}` : ` LIMIT ${parsedLimit} OFFSET ${parsedSkip}`;
};

const compareRows = (left, right, sort) => {
  const sortField = typeof sort === 'string' && sort.length > 0 ? (sort.startsWith('-') ? sort.slice(1) : sort) : 'id';
  const sortDirection = typeof sort === 'string' && sort.startsWith('-') ? -1 : 1;
  const leftValue = left?.[sortField] ?? null;
  const rightValue = right?.[sortField] ?? null;

  if (leftValue === rightValue) {
    const leftId = String(left?.id ?? '');
    const rightId = String(right?.id ?? '');
    return leftId.localeCompare(rightId);
  }

  if (leftValue === null) return 1;
  if (rightValue === null) return -1;
  return leftValue > rightValue ? sortDirection : -sortDirection;
};

const mapCentralRowToShiftEntry = (row, doctorId) => ({
  ...fromSqlRow(row),
  doctor_id: doctorId,
});

const mapShiftEntryToCentralRecord = ({ shift, employeeId, tenantId, tenantDoctorId, preserveId = true }) => ({
  id: preserveId && shift.id ? shift.id : crypto.randomUUID(),
  employee_id: employeeId,
  date: toDateString(shift.date),
  position: shift.position,
  note: shift.note ?? null,
  start_time: shift.start_time ?? null,
  end_time: shift.end_time ?? null,
  break_minutes: shift.break_minutes ?? null,
  timeslot_id: shift.timeslot_id ?? null,
  order: shift.order ?? null,
  created_date: shift.created_date ?? new Date(),
  updated_date: shift.updated_date ?? new Date(),
  created_by: shift.created_by ?? null,
  source_tenant_id: tenantId ?? null,
  source_tenant_doctor_id: tenantDoctorId ?? null,
});

async function loadLinkedDoctors(tenantDb, filters = {}) {
  const clauses = ['central_employee_id IS NOT NULL', "central_employee_id != ''"];
  const params = [];

  if (filters.doctor_id && typeof filters.doctor_id !== 'object') {
    clauses.push('id = ?');
    params.push(filters.doctor_id);
  }

  const [rows] = await tenantDb.execute(
    `SELECT id, central_employee_id FROM Doctor WHERE ${clauses.join(' AND ')}`,
    params
  );

  return rows.map((row) => ({
    doctor_id: String(row.id),
    employee_id: String(row.central_employee_id),
  }));
}

export function isCentralAbsencePosition(position) {
  if (CENTRAL_ABSENCE_POSITIONS.has(position)) return true;
  return CENTRAL_ABSENCE_POSITIONS_NORMALIZED.has(normalizeShiftPosition(position));
}

export async function ensureCentralAbsenceTables(masterDb) {
  if (centralAbsenceTableEnsured) return;
  await masterDb.execute(`
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
  centralAbsenceTableEnsured = true;
}

export async function listShiftEntriesWithCentralAbsences({
  tenantDb,
  masterDb,
  filters = {},
  sort,
  limit,
  skip,
}) {
  const where = buildWhereClause(filters);
  const [tenantRows] = await tenantDb.execute(
    `SELECT * FROM ShiftEntry${where.sql}`,
    where.params
  );

  const linkedDoctors = await loadLinkedDoctors(tenantDb, filters);
  if (linkedDoctors.length === 0) {
    return tenantRows.map(fromSqlRow);
  }

  await ensureCentralAbsenceTables(masterDb);

  const linkedDoctorIds = new Set(linkedDoctors.map((row) => row.doctor_id));
  const employeeByDoctorId = new Map(linkedDoctors.map((row) => [row.doctor_id, row.employee_id]));
  const doctorByEmployeeId = new Map(linkedDoctors.map((row) => [row.employee_id, row.doctor_id]));

  // Keep all local rows here. Local absence rows of linked doctors are only
  // hidden when an equivalent central row exists (dedup below). This keeps
  // not-yet-migrated absences visible after deploy and during partial migration.
  const localRows = tenantRows.map(fromSqlRow);

  const employeeIds = Array.from(new Set(linkedDoctors.map((row) => row.employee_id)));
  if (employeeIds.length === 0) {
    return localRows;
  }

  const centralClauses = [`employee_id IN (${employeeIds.map(() => '?').join(',')})`];
  const centralParams = [...employeeIds];

  if (filters.id && typeof filters.id !== 'object') {
    centralClauses.push('id = ?');
    centralParams.push(filters.id);
  }

  if (filters.position && typeof filters.position !== 'object') {
    if (!isCentralAbsencePosition(filters.position)) {
      return localRows;
    }
    centralClauses.push('position = ?');
    centralParams.push(filters.position);
  }

  if (filters.date && typeof filters.date === 'object') {
    if (hasOwn(filters.date, '$gte')) {
      centralClauses.push('date >= ?');
      centralParams.push(filters.date.$gte);
    }
    if (hasOwn(filters.date, '$lte')) {
      centralClauses.push('date <= ?');
      centralParams.push(filters.date.$lte);
    }
  } else if (filters.date) {
    centralClauses.push('date = ?');
    centralParams.push(filters.date);
  }

  if (filters.doctor_id && typeof filters.doctor_id !== 'object') {
    const employeeId = employeeByDoctorId.get(String(filters.doctor_id));
    if (!employeeId) {
      return localRows;
    }
    centralClauses.push('employee_id = ?');
    centralParams.push(employeeId);
  }

  if (filters.timeslot_id && typeof filters.timeslot_id !== 'object') {
    centralClauses.push('timeslot_id = ?');
    centralParams.push(filters.timeslot_id);
  }

  const centralWhere = centralClauses.length > 0 ? ` WHERE ${centralClauses.join(' AND ')}` : '';
  const [centralRows] = await masterDb.execute(
    `SELECT ${CENTRAL_ABSENCE_COLUMNS.map((column) => `\`${column}\``).join(', ')} FROM CentralAbsenceEntry${centralWhere}`,
    centralParams
  );

  // Dedup: hide a local linked-doctor absence row only when the same
  // (employee, date, position) already exists centrally. Until then the local
  // copy stays visible so migration is non-destructive to the read view.
  // Normalize the position on both sides so case/umlaut variants of the
  // same absence (e.g. 'Urlaub' vs 'urlaub') collapse to one entry.
  const centralKeys = new Set(
    centralRows.map((row) => `${row.employee_id}|${toDateString(row.date)}|${normalizeShiftPosition(row.position)}`)
  );
  const dedupedLocalRows = localRows.filter((row) => {
    if (!linkedDoctorIds.has(String(row.doctor_id)) || !isCentralAbsencePosition(row.position)) {
      return true;
    }
    const employeeId = employeeByDoctorId.get(String(row.doctor_id));
    if (!employeeId) return true;
    return !centralKeys.has(`${employeeId}|${toDateString(row.date)}|${normalizeShiftPosition(row.position)}`);
  });

  const combinedRows = [
    ...dedupedLocalRows,
    ...centralRows
      .map((row) => mapCentralRowToShiftEntry(row, doctorByEmployeeId.get(String(row.employee_id))))
      .filter((row) => !!row.doctor_id),
  ].sort((left, right) => compareRows(left, right, sort));

  const limitClause = buildLimitClause(limit, skip);
  if (!limitClause) {
    return combinedRows;
  }

  const parsedLimit = Number.parseInt(limit, 10);
  const parsedSkip = skip && !Number.isNaN(Number.parseInt(skip, 10)) ? Number.parseInt(skip, 10) : 0;
  return combinedRows.slice(parsedSkip, parsedSkip + parsedLimit);
}

export async function getShiftEntryWithCentralAbsence({ tenantDb, masterDb, id }) {
  const [tenantRows] = await tenantDb.execute('SELECT * FROM ShiftEntry WHERE id = ? LIMIT 1', [id]);
  if (tenantRows.length > 0) {
    return fromSqlRow(tenantRows[0]);
  }

  await ensureCentralAbsenceTables(masterDb);

  const [centralRows] = await masterDb.execute(
    `SELECT ${CENTRAL_ABSENCE_COLUMNS.map((column) => `\`${column}\``).join(', ')} FROM CentralAbsenceEntry WHERE id = ? LIMIT 1`,
    [id]
  );
  if (centralRows.length === 0) {
    return null;
  }

  const [doctorRows] = await tenantDb.execute(
    'SELECT id FROM Doctor WHERE central_employee_id = ? LIMIT 1',
    [centralRows[0].employee_id]
  );
  if (doctorRows.length === 0) {
    return null;
  }

  return mapCentralRowToShiftEntry(centralRows[0], doctorRows[0].id);
}

export async function writeShiftEntryToCentralAbsence({
  tenantDb,
  masterDb,
  tenantId,
  shiftEntry,
  doctorId,
  preserveId = true,
}) {
  const [doctorRows] = await tenantDb.execute(
    'SELECT central_employee_id FROM Doctor WHERE id = ? LIMIT 1',
    [doctorId]
  );
  const employeeId = doctorRows[0]?.central_employee_id ? String(doctorRows[0].central_employee_id) : null;
  if (!employeeId) {
    return null;
  }

  await ensureCentralAbsenceTables(masterDb);

  const record = mapShiftEntryToCentralRecord({
    shift: shiftEntry,
    employeeId,
    tenantId,
    tenantDoctorId: doctorId,
    preserveId,
  });

  const insertColumns = CENTRAL_ABSENCE_COLUMNS;
  const placeholders = insertColumns.map(() => '?').join(', ');
  const updateColumns = insertColumns.filter((column) => !['id', 'employee_id', 'date', 'created_date'].includes(column));
  const values = insertColumns.map((column) => record[column] ?? null);

  await masterDb.execute(
    `INSERT INTO CentralAbsenceEntry (${insertColumns.map((column) => `\`${column}\``).join(', ')})
     VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updateColumns.map((column) => `\`${column}\` = VALUES(\`${column}\`)`).join(', ')}`,
    values
  );

  const [rows] = await masterDb.execute(
    `SELECT ${CENTRAL_ABSENCE_COLUMNS.map((column) => `\`${column}\``).join(', ')} FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ? LIMIT 1`,
    [employeeId, record.date]
  );

  return rows[0] ? mapCentralRowToShiftEntry(rows[0], doctorId) : null;
}

export async function deleteCentralAbsenceById(masterDb, id) {
  await ensureCentralAbsenceTables(masterDb);
  await masterDb.execute('DELETE FROM CentralAbsenceEntry WHERE id = ?', [id]);
}

export async function migrateTenantDoctorAbsencesToCentral({
  tenantDb,
  masterDb,
  tenantId,
  doctorId,
  employeeId: masterEmployeeId = null,
}) {
  const [doctorRows] = await tenantDb.execute(
    'SELECT central_employee_id FROM Doctor WHERE id = ? LIMIT 1',
    [doctorId]
  );
  if (doctorRows.length === 0) {
    // The tenant_doctor_id stored in the master assignment does not match any
    // Doctor row in this tenant. We cannot migrate; surface the mismatch
    // instead of silently reporting an empty success.
    return {
      imported: 0,
      removedLocal: 0,
      localAbsences: 0,
      existingCentral: 0,
      skippedInvalidDate: [],
      linkStatus: 'tenant_doctor_missing',
    };
  }

  const tenantEmployeeId = doctorRows[0].central_employee_id
    ? String(doctorRows[0].central_employee_id)
    : null;
  // The master EmployeeTenantAssignment is the authoritative link. When the
  // tenant Doctor row has no central_employee_id yet (master and tenant link
  // state drifted apart), fall back to the employee_id the assignment carries.
  const employeeId = tenantEmployeeId || (masterEmployeeId ? String(masterEmployeeId) : null);
  if (!employeeId) {
    return {
      imported: 0,
      removedLocal: 0,
      localAbsences: 0,
      existingCentral: 0,
      skippedInvalidDate: [],
      linkStatus: 'unlinked',
    };
  }

  // Repair the missing tenant link before touching any rows. This is required
  // so the read-merge recognises the doctor as linked and shows the migrated
  // absences again — without it, moving them to central storage would make
  // them vanish from the tenant calendar.
  let linkRepaired = false;
  if (!tenantEmployeeId) {
    await tenantDb.execute(
      'UPDATE Doctor SET central_employee_id = ? WHERE id = ?',
      [employeeId, doctorId]
    );
    linkRepaired = true;
  }

  await ensureCentralAbsenceTables(masterDb);

  const [tenantRows] = await tenantDb.execute(
    'SELECT * FROM ShiftEntry WHERE doctor_id = ?',
    [doctorId]
  );
  const absenceRows = tenantRows.filter((row) => isCentralAbsencePosition(row.position));

  let imported = 0;
  let existingCentral = 0;
  const skippedInvalidDate = [];
  const migratedIds = [];
  for (const row of absenceRows) {
    const date = toDateString(row.date);
    // CentralAbsenceEntry.date is NOT NULL. Skip rows that have a null/empty
    // date so we never crash the whole migration on bad tenant data. These
    // rows stay on the tenant side until the admin fixes the source.
    if (!date) {
      skippedInvalidDate.push({ id: row.id, position: row.position });
      continue;
    }
    const [existingRows] = await masterDb.execute(
      'SELECT id FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ? LIMIT 1',
      [employeeId, date]
    );
    if (existingRows.length > 0) {
      existingCentral += 1;
      continue;
    }

    await writeShiftEntryToCentralAbsence({
      tenantDb,
      masterDb,
      tenantId,
      shiftEntry: row,
      doctorId,
      preserveId: true,
    });
    migratedIds.push(row.id);
    imported += 1;
  }

  // Never partially migrate: if any local absence could not be moved (bad
  // date, write failure that we caught, etc.) we keep the local rows in
  // place so the user does not silently lose data. The admin can fix the
  // offending row and re-run.
  if (skippedInvalidDate.length > 0) {
    console.warn(
      `[Master absences] Skipped ${skippedInvalidDate.length} tenant absence row(s) for doctor ${doctorId} (employee ${employeeId}) due to invalid date:`,
      skippedInvalidDate
    );
    return {
      imported,
      removedLocal: 0,
      skippedInvalidDate,
      localAbsences: absenceRows.length,
      existingCentral,
      linkStatus: linkRepaired ? 'repaired' : 'ok',
      linkRepaired,
    };
  }

  // Delete by id list so we cover position-spelling variants (PascalCase,
  // lowercase, umlaut-stripped) and only remove rows that were actually
  // imported — never rows that are still skipped or unchanged.
  if (migratedIds.length > 0) {
    await tenantDb.execute(
      `DELETE FROM ShiftEntry WHERE id IN (${migratedIds.map(() => '?').join(', ')})`,
      migratedIds
    );
  }

  return {
    imported,
    removedLocal: imported,
    skippedInvalidDate: [],
    localAbsences: absenceRows.length,
    existingCentral,
    linkStatus: linkRepaired ? 'repaired' : 'ok',
    linkRepaired,
  };
}

export async function previewTenantDoctorAbsenceMigration({
  tenantDb,
  masterDb,
  doctorId,
  employeeId: masterEmployeeId = null,
}) {
  const [doctorRows] = await tenantDb.execute(
    'SELECT central_employee_id FROM Doctor WHERE id = ? LIMIT 1',
    [doctorId]
  );
  if (doctorRows.length === 0) {
    return {
      imported: 0,
      removedLocal: 0,
      localAbsences: 0,
      existingCentral: 0,
      linkStatus: 'tenant_doctor_missing',
    };
  }

  const tenantEmployeeId = doctorRows[0].central_employee_id
    ? String(doctorRows[0].central_employee_id)
    : null;
  // Mirror the real migration: the master assignment is authoritative, so fall
  // back to it when the tenant Doctor row has no central_employee_id yet.
  const employeeId = tenantEmployeeId || (masterEmployeeId ? String(masterEmployeeId) : null);
  if (!employeeId) {
    return {
      imported: 0,
      removedLocal: 0,
      localAbsences: 0,
      existingCentral: 0,
      linkStatus: 'unlinked',
    };
  }
  const linkRepairNeeded = !tenantEmployeeId;

  await ensureCentralAbsenceTables(masterDb);

  const [tenantRows] = await tenantDb.execute(
    'SELECT * FROM ShiftEntry WHERE doctor_id = ?',
    [doctorId]
  );
  const absenceRows = tenantRows.filter((row) => isCentralAbsencePosition(row.position));
  if (absenceRows.length === 0) {
    return {
      imported: 0,
      removedLocal: 0,
      localAbsences: 0,
      existingCentral: 0,
      linkStatus: linkRepairNeeded ? 'repair_needed' : 'ok',
    };
  }

  let imported = 0;
  let existingCentral = 0;
  const skippedInvalidDate = [];
  for (const row of absenceRows) {
    const date = toDateString(row.date);
    if (!date) {
      skippedInvalidDate.push({ id: row.id, position: row.position });
      continue;
    }
    const [existingRows] = await masterDb.execute(
      'SELECT id FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ? LIMIT 1',
      [employeeId, date]
    );
    if (existingRows.length > 0) {
      existingCentral += 1;
      continue;
    }
    imported += 1;
  }

  return {
    imported,
    removedLocal: absenceRows.length,
    localAbsences: absenceRows.length,
    existingCentral,
    skippedInvalidDate,
    linkStatus: linkRepairNeeded ? 'repair_needed' : 'ok',
  };
}

export async function seedTenantDoctorAbsencesFromCentral({
  tenantDb,
  masterDb,
  doctorId,
  employeeId,
  createdBy,
}) {
  if (!employeeId) {
    return { copied: 0 };
  }

  await ensureCentralAbsenceTables(masterDb);

  const [centralRows] = await masterDb.execute(
    `SELECT ${CENTRAL_ABSENCE_COLUMNS.map((column) => `\`${column}\``).join(', ')} FROM CentralAbsenceEntry WHERE employee_id = ? ORDER BY date ASC`,
    [employeeId]
  );

  // Clear all central-absence rows for this doctor regardless of position
  // spelling (PascalCase, lowercase, umlaut-stripped) so the seed-back
  // rebuilds a clean tenant copy from the master storage.
  const [absenceLocalRows] = await tenantDb.execute(
    'SELECT id, position FROM ShiftEntry WHERE doctor_id = ?',
    [doctorId]
  );
  const absenceIdsToDelete = absenceLocalRows
    .filter((row) => isCentralAbsencePosition(row.position))
    .map((row) => row.id);
  if (absenceIdsToDelete.length > 0) {
    await tenantDb.execute(
      `DELETE FROM ShiftEntry WHERE id IN (${absenceIdsToDelete.map(() => '?').join(', ')})`,
      absenceIdsToDelete
    );
  }

  for (const row of centralRows) {
    const payload = {
      id: row.id,
      doctor_id: doctorId,
      date: toDateString(row.date),
      position: row.position,
      note: row.note ?? null,
      start_time: row.start_time ?? null,
      end_time: row.end_time ?? null,
      break_minutes: row.break_minutes ?? null,
      timeslot_id: row.timeslot_id ?? null,
      order: row.order ?? null,
      created_date: row.created_date ?? new Date(),
      updated_date: row.updated_date ?? new Date(),
      created_by: createdBy ?? row.created_by ?? null,
    };
    const keys = Object.keys(payload);
    const placeholders = keys.map(() => '?').join(', ');
    await tenantDb.execute(
      `INSERT INTO ShiftEntry (${keys.map((column) => `\`${column}\``).join(', ')}) VALUES (${placeholders})`,
      keys.map((key) => payload[key])
    );
  }

  return { copied: centralRows.length };
}

export async function migrateLinkedAssignmentsToCentral({
  assignments,
  tokensById,
  withTenantDb,
  masterDb,
  dryRun = false,
}) {
  const results = [];
  let migratedAssignments = 0;
  let importedAbsences = 0;
  let removedLocalAbsences = 0;
  let skippedAssignments = 0;
  let failedAssignments = 0;
  let existingCentralAbsences = 0;

  for (const assignment of assignments || []) {
    const tenantId = String(assignment.tenant_id || '');
    const doctorId = assignment.tenant_doctor_id || null;
    const token = tokensById.get(tenantId);

    if (!tenantId || !doctorId || !token) {
      skippedAssignments += 1;
      results.push({
        employee_id: assignment.employee_id,
        employee_name: assignment.employee_name || null,
        tenant_id: assignment.tenant_id,
        tenant_name: assignment.tenant_name || null,
        tenant_doctor_id: assignment.tenant_doctor_id,
        status: 'skipped',
        reason: !doctorId ? 'Keine Tenant-Verknüpfung vorhanden' : 'Mandant nicht verfügbar',
      });
      continue;
    }

    try {
      const migrationResult = await withTenantDb(token, async (tenantDb) => (
        dryRun
          ? await previewTenantDoctorAbsenceMigration({
              tenantDb,
              masterDb,
              doctorId,
              employeeId: assignment.employee_id || null,
            })
          : await migrateTenantDoctorAbsencesToCentral({
              tenantDb,
              masterDb,
              tenantId,
              doctorId,
              employeeId: assignment.employee_id || null,
            })
      ));

      if (!migrationResult) {
        skippedAssignments += 1;
        results.push({
          employee_id: assignment.employee_id,
          employee_name: assignment.employee_name || null,
          tenant_id: assignment.tenant_id,
          tenant_name: assignment.tenant_name || null,
          tenant_doctor_id: assignment.tenant_doctor_id,
          status: 'skipped',
          reason: 'Mandant konnte nicht verbunden werden',
        });
        continue;
      }

      migratedAssignments += 1;
      importedAbsences += Number(migrationResult.imported || 0);
      removedLocalAbsences += Number(migrationResult.removedLocal || 0);
      existingCentralAbsences += Number(migrationResult.existingCentral || 0);
      results.push({
        employee_id: assignment.employee_id,
        employee_name: assignment.employee_name || null,
        tenant_id: assignment.tenant_id,
        tenant_name: assignment.tenant_name || null,
        tenant_doctor_id: assignment.tenant_doctor_id,
        status: 'success',
        imported: Number(migrationResult.imported || 0),
        removedLocal: Number(migrationResult.removedLocal || 0),
        localAbsences: Number(migrationResult.localAbsences || migrationResult.removedLocal || 0),
        existingCentral: Number(migrationResult.existingCentral || 0),
        linkStatus: migrationResult.linkStatus || 'ok',
        dry_run: dryRun,
      });
    } catch (error) {
      failedAssignments += 1;
      results.push({
        employee_id: assignment.employee_id,
        employee_name: assignment.employee_name || null,
        tenant_id: assignment.tenant_id,
        tenant_name: assignment.tenant_name || null,
        tenant_doctor_id: assignment.tenant_doctor_id,
        status: 'error',
        error: error.message,
      });
    }
  }

  return {
    results,
    migratedAssignments,
    importedAbsences,
    removedLocalAbsences,
    existingCentralAbsences,
    skippedAssignments,
    failedAssignments,
    totalAssignments: results.length,
    dryRun,
  };
}