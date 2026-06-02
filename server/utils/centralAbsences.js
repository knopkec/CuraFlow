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

// Conflict resolution priority for central absence storage. Higher number =
// stronger reason for the day to be this kind of absence. Used by the
// opt-in `resolveConflicts` pass to decide which side wins when a local
// absence row and an existing central row share the same (employee, date)
// but disagree on the position. The strongest legally/medically binding
// reason wins; soft planning entries (Frei/Urlaub) yield to anything
// stricter. Ties (same priority, different position) are NEVER auto-resolved
// — the admin must fix them in the tenant.
const ABSENCE_PRIORITY = {
  Mutterschutz: 100,
  Elternzeit: 90,
  Krank: 80,
  Fortbildung: 60,
  Kongress: 55,
  Dienstreise: 40,
  'Nicht verfügbar': 30,
  Urlaub: 20,
  Frei: 10,
};

const absencePriority = (position) => {
  if (position === null || position === undefined) return 0;
  // Look up by canonical PascalCase first, then by the normalized form so
  // legacy lowercase/umlaut-stripped spellings resolve to the same priority.
  if (Object.prototype.hasOwnProperty.call(ABSENCE_PRIORITY, position)) {
    return ABSENCE_PRIORITY[position];
  }
  const normalized = normalizeShiftPosition(position);
  for (const [key, value] of Object.entries(ABSENCE_PRIORITY)) {
    if (normalizeShiftPosition(key) === normalized) {
      return value;
    }
  }
  return 0;
};

export { ABSENCE_PRIORITY, absencePriority };

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

// CentralAbsenceEntry.date is NOT NULL DATE. Classify why a tenant ShiftEntry
// row would fail to migrate so the admin can fix the source row. Returned to
// the caller as `reason` and logged on the server so an offline re-run with
// verbose logs gives an exact data map of what to fix.
const classifyInvalidDate = (raw) => {
  if (raw === null || raw === undefined) {
    return { reason: 'leer (null/undefined)', normalized: null };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return { reason: 'leerer String', normalized: null };
    if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return { reason: `unerwartetes Datumsformat: ${JSON.stringify(trimmed.slice(0, 40))}`, normalized: null };
    }
    const parsed = new Date(trimmed.slice(0, 10));
    if (Number.isNaN(parsed.getTime())) {
      return { reason: `kein gültiges Kalenderdatum: ${JSON.stringify(trimmed.slice(0, 10))}`, normalized: null };
    }
    return { reason: null, normalized: trimmed.slice(0, 10) };
  }
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      return { reason: 'Date-Objekt mit NaN', normalized: null };
    }
    return { reason: null, normalized: raw.toISOString().slice(0, 10) };
  }
  return { reason: `unerwarteter Typ: ${typeof raw} (Wert: ${JSON.stringify(String(raw).slice(0, 40))})`, normalized: null };
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

// Update the position of a central absence entry in place. Used by the
// resolve-conflicts pass when a local absence has a higher priority than
// the central one for the same (employee, date). The updated_date column
// is bumped automatically by the table's ON UPDATE CURRENT_TIMESTAMP.
export async function updateCentralAbsencePosition(masterDb, id, position) {
  await ensureCentralAbsenceTables(masterDb);
  await masterDb.execute(
    'UPDATE CentralAbsenceEntry SET position = ? WHERE id = ?',
    [position, id]
  );
}

export async function migrateTenantDoctorAbsencesToCentral({
  tenantDb,
  masterDb,
  tenantId,
  doctorId,
  employeeId: masterEmployeeId = null,
  resolveConflicts = false,
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
  const conflicts = [];
  const migratedIds = [];
  const redundantIds = [];
  for (const row of absenceRows) {
    // CentralAbsenceEntry.date is NOT NULL DATE. Rows with missing/empty or
    // non-parseable dates are kept local and reported with the exact reason
    // so the admin can fix the source. We never crash the whole migration on
    // a single bad row.
    const classified = classifyInvalidDate(row.date);
    if (!classified.normalized) {
      skippedInvalidDate.push({
        id: row.id,
        position: row.position,
        raw_date: row.date,
        reason: classified.reason,
      });
      continue;
    }
    const date = classified.normalized;
    const [existingRows] = await masterDb.execute(
      'SELECT id, position FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ? LIMIT 1',
      [employeeId, date]
    );
    if (existingRows.length > 0) {
      const sameAbsence = normalizeShiftPosition(existingRows[0].position) === normalizeShiftPosition(row.position);
      if (sameAbsence) {
        // The central store already holds the exact same absence (employee +
        // date + normalized position). The read-merge already hides this local
        // row, so it is a redundant leftover from an earlier migration. Clean
        // it up so it stops lingering and inflating the local count.
        existingCentral += 1;
        redundantIds.push(row.id);
      } else {
        // A different absence already occupies this day. The central unique
        // key is (employee_id, date), so we cannot move ours without
        // overwriting. Keep the local row and report the conflict unless
        // resolveConflicts is on AND the local row has a strictly higher
        // priority (medically/legally binding reasons beat planning entries)
        // — then update the central row in place and drop the local copy.
        // A tie is NEVER auto-resolved: the admin must fix the tenant.
        const localPrio = absencePriority(row.position);
        const centralPrio = absencePriority(existingRows[0].position);
        if (resolveConflicts && localPrio > centralPrio) {
          await updateCentralAbsencePosition(masterDb, existingRows[0].id, row.position);
          console.warn(
            `[Master absences] Resolved conflict: doctor=${doctorId} employee=${employeeId} date=${date} central "${existingRows[0].position}" (prio ${centralPrio}) ← local "${row.position}" (prio ${localPrio})`
          );
          conflicts.push({
            id: row.id,
            date,
            localPosition: row.position,
            centralPosition: existingRows[0].position,
            resolution: 'local_wins',
            resolvedByPriority: { local: localPrio, central: centralPrio },
          });
          // The local row is no longer needed; the central store now holds
          // the higher-priority position and the read-merge keeps it visible.
          // We delete the local copy as part of the regular removableIds
          // batch so we do not need a separate DELETE here.
          redundantIds.push(row.id);
        } else if (resolveConflicts && centralPrio > localPrio) {
          // Central already has a stronger reason for this day. Drop the
          // local copy — the read-merge keeps the central row visible.
          console.warn(
            `[Master absences] Resolved conflict: doctor=${doctorId} employee=${employeeId} date=${date} central "${existingRows[0].position}" (prio ${centralPrio}) kept, local "${row.position}" (prio ${localPrio}) dropped`
          );
          conflicts.push({
            id: row.id,
            date,
            localPosition: row.position,
            centralPosition: existingRows[0].position,
            resolution: 'central_wins',
            resolvedByPriority: { local: localPrio, central: centralPrio },
          });
          redundantIds.push(row.id);
        } else {
          conflicts.push({
            id: row.id,
            date,
            localPosition: row.position,
            centralPosition: existingRows[0].position,
            resolution: 'unresolved',
            resolvedByPriority: { local: localPrio, central: centralPrio },
          });
        }
      }
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

  // Rows with an invalid/empty date are left untouched (they were never added
  // to migratedIds or redundantIds), so the admin can fix the source. This
  // must NOT block cleaning up the rows that are already safely represented
  // centrally — deleting an exact central duplicate or a freshly imported row
  // is not data loss. Blocking the whole doctor here was the bug that made
  // "Migrieren" appear to do nothing while the dry-run kept reporting work.
  if (skippedInvalidDate.length > 0) {
    // One line per offending row so an offline grep finds every row the admin
    // has to fix. Format: doctor <id> | row <id> | reason | raw_date.
    for (const entry of skippedInvalidDate) {
      console.warn(
        `[Master absences] Skipped tenant absence row: doctor=${doctorId} employee=${employeeId} row_id=${entry.id} position=${JSON.stringify(entry.position)} raw_date=${JSON.stringify(entry.raw_date)} reason="${entry.reason}"`
      );
    }
  }

  // Delete by id list so we cover position-spelling variants (PascalCase,
  // lowercase, umlaut-stripped). We remove the rows we just imported, the
  // redundant leftovers whose exact central duplicate already exists, AND
  // the conflict rows that the resolveConflicts pass has settled
  // (local_wins → local copy is now redundant; central_wins → local copy
  // yields to the stronger central row). We never touch invalid-date rows
  // (kept for the admin to fix) and we never touch unresolved ties (admin
  // must resolve by hand).
  const removableIds = [...migratedIds, ...redundantIds];
  if (removableIds.length > 0) {
    await tenantDb.execute(
      `DELETE FROM ShiftEntry WHERE id IN (${removableIds.map(() => '?').join(', ')})`,
      removableIds
    );
  }

  // Diagnostic: total central absences for this employee after the run, so the
  // report can confirm where the absences now live.
  const [centralCountRows] = await masterDb.execute(
    'SELECT COUNT(*) AS total FROM CentralAbsenceEntry WHERE employee_id = ?',
    [employeeId]
  );
  const centralTotal = Number(centralCountRows[0]?.total || 0);

  const resolvedConflicts = conflicts.filter((entry) => entry.resolution === 'local_wins' || entry.resolution === 'central_wins').length;
  const unresolvedConflicts = conflicts.filter((entry) => entry.resolution === 'unresolved' || !entry.resolution).length;
  const conflictExamples = conflicts.slice(0, 5).map((entry) => ({
    id: entry.id,
    date: entry.date,
    localPosition: entry.localPosition,
    centralPosition: entry.centralPosition,
    resolution: entry.resolution || 'unresolved',
  }));

  return {
    imported,
    removedLocal: removableIds.length,
    skippedInvalidDate,
    localAbsences: absenceRows.length,
    existingCentral,
    centralTotal,
    conflicts: conflicts.length,
    resolvedConflicts,
    unresolvedConflicts,
    conflictExamples,
    linkStatus: linkRepaired ? 'repaired' : 'ok',
    linkRepaired,
  };
}

// Permanent opt-in cleanup of tenant absence rows whose date is genuinely
// empty (null, undefined, empty/whitespace string). These rows are data
// garbage — they have no day to attribute the absence to, so neither the
// read-merge nor the central migration can represent them. The admin
// confirmed the reports: a handful of doctors still show "1 Eintrag mit
// ungültigem Datum" because of exactly these zero-value rows. After the
// regular migration runs and reports them, the admin invokes a SECOND
// "Leere Einträge löschen" pass to clear them out.
//
// Safety: we only delete rows where ALL conditions hold:
//   - position is a known central absence (isCentralAbsencePosition), so
//     we never touch a working shift that just happens to have a null date.
//   - reason is one of { "leer (null/undefined)", "leerer String",
//     "leere Zeichenkette" } — i.e. the date is genuinely empty. A row with
//     a garbage string date ("not-a-date") or a non-string/non-Date type is
//     NEVER deleted, because we cannot prove the date was never there.
//   - doctor_id matches the row's actual doctor_id (defence-in-depth).
// Each deletion is logged so a server grep gives a full audit trail.
const EMPTY_DATE_REASONS = new Set([
  'leer (null/undefined)',
  'leerer String',
]);

export async function purgeEmptyDateAbsences({ tenantDb, doctorId }) {
  const [rows] = await tenantDb.execute(
    'SELECT id, doctor_id, position, date FROM ShiftEntry WHERE doctor_id = ?',
    [doctorId]
  );

  const candidates = [];
  const skipped = [];
  for (const row of rows) {
    if (!isCentralAbsencePosition(row.position)) {
      continue;
    }
    const classified = classifyInvalidDate(row.date);
    if (classified.normalized) {
      continue;
    }
    if (!EMPTY_DATE_REASONS.has(classified.reason)) {
      skipped.push({
        id: row.id,
        position: row.position,
        raw_date: row.date,
        reason: classified.reason,
      });
      continue;
    }
    if (String(row.doctor_id) !== String(doctorId)) {
      // Defence-in-depth: a SQL mix-up must never delete the wrong doctor's
      // row. Skip and report.
      skipped.push({
        id: row.id,
        position: row.position,
        raw_date: row.date,
        reason: 'doctor_id stimmt nicht (übersprungen)',
      });
      continue;
    }
    candidates.push(row);
  }

  if (candidates.length > 0) {
    const ids = candidates.map((row) => row.id);
    await tenantDb.execute(
      `DELETE FROM ShiftEntry WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ids
    );
    for (const row of candidates) {
      console.warn(
        `[Master absences] Purged empty-date absence row: doctor=${doctorId} row_id=${row.id} position=${JSON.stringify(row.position)} raw_date=${JSON.stringify(row.date)}`
      );
    }
  }

  return { purged: candidates.length, skipped };
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

  // Diagnostic: how many central absences already exist for this employee,
  // independent of any local rows. This distinguishes "already fully migrated"
  // (0 local, N central) from "nothing anywhere" (0 local, 0 central). Without
  // it a fully-migrated doctor and a truly-empty doctor both look like 0/0/0.
  const [centralCountRows] = await masterDb.execute(
    'SELECT COUNT(*) AS total FROM CentralAbsenceEntry WHERE employee_id = ?',
    [employeeId]
  );
  const centralTotal = Number(centralCountRows[0]?.total || 0);

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
      centralTotal,
      linkStatus: linkRepairNeeded ? 'repair_needed' : 'ok',
    };
  }

  let imported = 0;
  let existingCentral = 0;
  const skippedInvalidDate = [];
  let conflicts = 0;
  let wouldResolveLocal = 0;
  let wouldResolveCentral = 0;
  let unresolvedConflicts = 0;
  const conflictExamples = [];
  for (const row of absenceRows) {
    const classified = classifyInvalidDate(row.date);
    if (!classified.normalized) {
      skippedInvalidDate.push({
        id: row.id,
        position: row.position,
        raw_date: row.date,
        reason: classified.reason,
      });
      continue;
    }
    const date = classified.normalized;
    const [existingRows] = await masterDb.execute(
      'SELECT id, position FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ? LIMIT 1',
      [employeeId, date]
    );
    if (existingRows.length > 0) {
      const sameAbsence = normalizeShiftPosition(existingRows[0].position) === normalizeShiftPosition(row.position);
      if (sameAbsence) {
        existingCentral += 1;
      } else {
        conflicts += 1;
        const localPrio = absencePriority(row.position);
        const centralPrio = absencePriority(existingRows[0].position);
        if (localPrio > centralPrio) {
          wouldResolveLocal += 1;
        } else if (centralPrio > localPrio) {
          wouldResolveCentral += 1;
        } else {
          unresolvedConflicts += 1;
        }
        if (conflictExamples.length < 5) {
          conflictExamples.push({
            id: row.id,
            date,
            localPosition: row.position,
            centralPosition: existingRows[0].position,
            localPriority: localPrio,
            centralPriority: centralPrio,
          });
        }
      }
      continue;
    }
    imported += 1;
  }

  // A real run would remove every local row that is now safely represented
  // centrally: the ones it imports plus the redundant duplicates. Conflict
  // rows stay local. This tells the admin how many local leftovers would be
  // cleaned up, so "Lokal" going to zero means "nothing left to do".
  const removableLocal = imported + existingCentral;

  return {
    imported,
    removedLocal: removableLocal,
    localAbsences: absenceRows.length,
    existingCentral,
    centralTotal,
    conflicts,
    wouldResolveLocal,
    wouldResolveCentral,
    unresolvedConflicts,
    conflictExamples,
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
  purgeEmptyDates = false,
  resolveConflicts = false,
}) {
  const results = [];
  let migratedAssignments = 0;
  let importedAbsences = 0;
  let removedLocalAbsences = 0;
  let skippedAssignments = 0;
  let failedAssignments = 0;
  let existingCentralAbsences = 0;
  let purgedEmptyAbsences = 0;
  let resolvedConflicts = 0;
  let unresolvedConflicts = 0;

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
      const migrationResult = await withTenantDb(token, async (tenantDb) => {
        const baseResult = dryRun
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
              resolveConflicts,
            });
        // Opt-in second pass: delete tenant absence rows whose date is
        // genuinely empty (null/empty string) and whose position is a known
        // central absence. Only run on a real (non-dry-run) pass and only
        // when the admin explicitly opted in — the regular migration must
        // never delete data the admin did not authorise.
        if (!dryRun && purgeEmptyDates) {
          const purgeResult = await purgeEmptyDateAbsences({ tenantDb, doctorId });
          return { ...baseResult, purgeResult };
        }
        return { ...baseResult, purgeResult: { purged: 0, skipped: [] } };
      });

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
      const removedLocal = Number(migrationResult.removedLocal || 0);
      const importedCount = Number(migrationResult.imported || 0);
      const conflicts = Number(migrationResult.conflicts || 0);
      const localAbsencesCount = Number(migrationResult.localAbsences || 0);
      const skippedInvalidDateList = Array.isArray(migrationResult.skippedInvalidDate)
        ? migrationResult.skippedInvalidDate
        : [];
      const skippedInvalidDate = skippedInvalidDateList.length;
      // Compact summary "row_id: reason" so the report fits in a cell while
      // the CSV / console still carry the full record with raw_date.
      const skippedInvalidDateSummary = skippedInvalidDateList
        .slice(0, 5)
        .map((entry) => `${entry.id}: ${entry.reason}`)
        .join('; ') + (skippedInvalidDateList.length > 5 ? ` (+${skippedInvalidDateList.length - 5} weitere)` : '');
      const purgeResult = migrationResult.purgeResult || { purged: 0, skipped: [] };
      const purgedForRow = Number(purgeResult.purged || 0);
      purgedEmptyAbsences += purgedForRow;
      // Conflict resolution accounting. In a real pass with resolveConflicts
      // on, resolvedConflicts counts the (employee, date) pairs that were
      // auto-settled by priority; unresolvedConflicts counts ties or rows the
      // admin still has to fix by hand. In a dry-run we use the
      // wouldResolveLocal/Right counters from the preview instead.
      const resolvedForRow = dryRun
        ? Number(migrationResult.wouldResolveLocal || 0) + Number(migrationResult.wouldResolveCentral || 0)
        : Number(migrationResult.resolvedConflicts || 0);
      const unresolvedForRow = Number(migrationResult.unresolvedConflicts || 0);
      resolvedConflicts += resolvedForRow;
      unresolvedConflicts += unresolvedForRow;
      const conflictExamples = Array.isArray(migrationResult.conflictExamples) ? migrationResult.conflictExamples : [];
      const conflictSummary = conflictExamples
        .slice(0, 5)
        .map((entry) => {
          const resolution = entry.resolution || (entry.localPriority > entry.centralPriority ? 'lokal gewinnt' : entry.centralPriority > entry.localPriority ? 'zentral gewinnt' : 'unentschieden');
          return `${entry.date}: ${entry.localPosition} vs ${entry.centralPosition} → ${resolution}`;
        })
        .join('; ') + (conflicts > 5 ? ` (+${conflicts - 5} weitere)` : '');
      // "Not yet fully migrated" means the doctor still has local absence rows.
      // The purge pass ran AFTER the local-count snapshot from the migration,
      // so subtract both the regular removals and the purged empties.
      const remainingLocal = Math.max(0, localAbsencesCount - removedLocal - purgedForRow);
      const needsAction = dryRun
        ? localAbsencesCount > 0
        : (remainingLocal > 0 || unresolvedForRow > 0);
      results.push({
        employee_id: assignment.employee_id,
        employee_name: assignment.employee_name || null,
        tenant_id: assignment.tenant_id,
        tenant_name: assignment.tenant_name || null,
        tenant_doctor_id: assignment.tenant_doctor_id,
        status: 'success',
        imported: importedCount,
        removedLocal,
        purgedEmpty: purgedForRow,
        localAbsences: localAbsencesCount,
        remainingLocal,
        skippedInvalidDate,
        skippedInvalidDateSummary,
        existingCentral: Number(migrationResult.existingCentral || 0),
        centralTotal: Number(migrationResult.centralTotal || 0),
        conflicts,
        resolvedConflicts: resolvedForRow,
        unresolvedConflicts: unresolvedForRow,
        conflictSummary,
        needsAction,
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
    purgedEmptyAbsences,
    resolvedConflicts,
    unresolvedConflicts,
    existingCentralAbsences,
    skippedAssignments,
    failedAssignments,
    assignmentsNeedingAction: results.filter((row) => row.needsAction).length,
    conflictAssignments: results.filter((row) => Number(row.conflicts || 0) > 0).length,
    totalAssignments: results.length,
    dryRun,
  };
}