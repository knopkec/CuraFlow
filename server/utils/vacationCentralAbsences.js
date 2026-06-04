/**
 * Pure (no-Express) helper for the tenant-side vacation endpoint.
 *
 * Lives in `utils/` (not `routes/`) so it can be imported by tests
 * without pulling in `auth.js` → `index.js` → mysql2 connection init.
 * The route in `routes/vacation.js` is a thin wrapper around this
 * helper; vitest targets this file directly.
 */
import { ensureCentralAbsenceTables, isCentralAbsencePosition } from './centralAbsences.js';

export const VACATION_ABSENCE_POSITIONS = [
  'Urlaub', 'Krank', 'Frei', 'Dienstreise', 'Nicht verfügbar',
  'Fortbildung', 'Kongress', 'Elternzeit', 'Mutterschutz',
];

const VACATION_ABSENCE_POSITIONS_SET = new Set(VACATION_ABSENCE_POSITIONS);

export { VACATION_ABSENCE_POSITIONS_SET };

/**
 * Resolves the central `employee_id` for a tenant doctor and returns the
 * central absence rows for the given year. Empty list (not 404) when
 * the doctor has no central link, so the frontend can render uniformly.
 *
 * @param {Object} deps
 * @param {import('mysql2/promise').Pool} deps.db      Master DB pool.
 * @param {string|null} deps.tenantId                   Already-resolved tenant UUID.
 * @param {string} deps.doctorId                        Tenant-local Doctor.id (string).
 * @param {number} deps.year                            Calendar year.
 * @returns {Promise<{ employee_id: string|null, absences: Array<{id:string,date:string,position:string,note:string|null,source:'central'}> }>}
 */
export async function fetchCentralAbsencesForDoctor({ db: masterDb, tenantId, doctorId, year }) {
  if (!tenantId) {
    return { employee_id: null, absences: [] };
  }

  // 1) Resolve central employee_id from the tenant assignment table.
  //    This is the ONLY source of truth we trust for the link — we
  //    intentionally do NOT fall back to Doctor.central_employee_id,
  //    because the master-frontend path is the only place that column
  //    is authoritative, and a stale value there would leak data.
  const [assignmentRows] = await masterDb.execute(
    `SELECT employee_id
       FROM EmployeeTenantAssignment
      WHERE tenant_id = ?
        AND tenant_doctor_id = ?
      LIMIT 1`,
    [tenantId, String(doctorId)]
  );

  if (assignmentRows.length === 0) {
    return { employee_id: null, absences: [], vacation_days_annual: null };
  }
  const employeeId = String(assignmentRows[0].employee_id);

  // 2) Fetch the central employee's vacation entitlement.
  let vacationDaysAnnual = null;
  try {
    const [empRows] = await masterDb.execute(
      `SELECT vacation_days_annual FROM Employee WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    if (empRows.length > 0) {
      vacationDaysAnnual = Number(empRows[0].vacation_days_annual);
    }
  } catch {
    // Graceful: if the Employee table or column doesn't exist yet,
    // we just don't provide the value; the frontend falls back.
    vacationDaysAnnual = null;
  }

  // 3) Ensure the central table exists, then read the rows.
  await ensureCentralAbsenceTables(masterDb);

  const placeholders = VACATION_ABSENCE_POSITIONS.map(() => '?').join(',');
  const [rows] = await masterDb.execute(
    `SELECT id, date, position, note
       FROM CentralAbsenceEntry
      WHERE employee_id = ?
        AND YEAR(date) = ?
        AND position IN (${placeholders})
      ORDER BY date ASC`,
    [employeeId, year, ...VACATION_ABSENCE_POSITIONS]
  );

  const absences = rows
    // Defensive: even if the DB contains a non-tracked position string
    // (legacy data, manual edits), filter it out instead of leaking it.
    .filter((row) => isCentralAbsencePosition(row.position))
    .map((row) => {
      // Date comes back from mysql2 as a JS Date in local TZ; we want
      // the canonical YYYY-MM-DD string the rest of the app uses.
      const dateStr = row.date instanceof Date
        ? row.date.toISOString().slice(0, 10)
        : String(row.date).slice(0, 10);
      return {
        id: String(row.id),
        date: dateStr,
        position: row.position,
        note: row.note ?? null,
        source: 'central',
      };
    });

  return { employee_id: employeeId, absences, vacation_days_annual: vacationDaysAnnual };
}
