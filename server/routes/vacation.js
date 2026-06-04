/**
 * Tenant-side vacation endpoints.
 *
 * Surfaces the central `CentralAbsenceEntry` table to the tenant frontend
 * (e.g. DoctorYearView) without depending on the ShiftEntry merge path
 * inside `dbProxy`. This is the authoritative source for absences of
 * employees that have been linked to the central Employee database and
 * migrated to the central absence table.
 *
 * Without this endpoint the tenant-frontend would only see absence rows
 * that still exist in the local `ShiftEntry` table — once the
 * "Migrate linked absences" job runs, the local rows are removed and
 * only the central rows remain.
 *
 * Authentication:
 *   - `authMiddleware` (JWT in Authorization header) is required.
 *   - Tenant resolution uses the `x-db-token` header, exactly like
 *     `/api/groups`. Users without a tenant token get a 400.
 *
 * The endpoint never exposes data from other tenants: the link is
 * resolved strictly from `EmployeeTenantAssignment` rows for the
 * active tenant.
 */
import express from 'express';
import { authMiddleware } from './auth.js';
import { db } from '../index.js';
import { resolveTenantIdFromToken } from '../utils/tenantGroups.js';
import {
  fetchCentralAbsencesForDoctor,
  VACATION_ABSENCE_POSITIONS,
  VACATION_ABSENCE_POSITIONS_SET,
} from '../utils/vacationCentralAbsences.js';

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/vacation/central-absences
 *   ?year=2026          (required)
 *   &doctorId=123       (required, tenant-local Doctor.id)
 *
 * Returns the central absence rows for the given tenant doctor in the
 * given year. The rows are normalised to the same `date/position/note`
 * shape the tenant `ShiftEntry` uses, so the frontend can merge both
 * sources transparently.
 */
router.get('/central-absences', async (req, res, next) => {
  try {
    const year = parseInt(req.query.year, 10);
    const doctorId = req.query.doctorId;

    if (!Number.isFinite(year) || year < 1970 || year > 2999) {
      return res.status(400).json({ error: 'Parameter "year" ist erforderlich (z.B. 2026).' });
    }
    if (doctorId == null || doctorId === '') {
      return res.status(400).json({ error: 'Parameter "doctorId" ist erforderlich.' });
    }

    const dbToken = req.headers['x-db-token'];
    const tenantId = await resolveTenantIdFromToken(db, dbToken);
    if (!tenantId) {
      return res.status(400).json({
        error: 'Mandanten-Token fehlt. Bitte mit aktivem Mandanten verbinden.',
      });
    }

    const { employee_id, absences, vacation_days_annual } = await fetchCentralAbsencesForDoctor({
      db,
      tenantId,
      doctorId: String(doctorId),
      year,
    });

    return res.json({
      year,
      doctorId: String(doctorId),
      employee_id,
      absences,
      vacation_days_annual,
    });
  } catch (error) {
    console.error('[vacation] central-absences failed', {
      year: req.query.year,
      doctorId: req.query.doctorId,
      message: error.message,
      code: error.code,
    });
    return next(error);
  }
});

// Re-export so consumers can introspect the supported positions without
// pulling in the utils module directly.
export { VACATION_ABSENCE_POSITIONS, VACATION_ABSENCE_POSITIONS_SET };

export default router;
