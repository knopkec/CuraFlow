/**
 * Routes for cross-department pool scheduling (tenant_group).
 *
 * Lives in the master DB. See docs/features/TENANT_GROUPS.md for the
 * overall design.
 *
 * Permission model:
 *  - read access  → user.allowed_groups includes :groupId, OR user.role = 'admin'
 *  - write access → user.group_admin_groups includes :groupId, OR user.role = 'admin'
 *  - group CRUD (create/delete) → master admin only
 */
import express from 'express';
import crypto from 'crypto';
import { db } from '../index.js';
import { authMiddleware, adminMiddleware } from './auth.js';
import {
  loadUserGroupContext,
  listUserGroups,
  loadGroupTenantIds,
  requireGroupReadAccess,
  requireGroupWriteAccess,
  resolveTenantIdFromToken,
  loadVisibleGroupIdsForTenant,
  canWriteShiftInGroup,
} from '../utils/tenantGroups.js';
import { validateProposedShift } from '../utils/poolConstraints.js';

const router = express.Router();

router.use(authMiddleware);

// All routes below require an authenticated user. They operate exclusively
// on the master DB, so we ignore any x-db-token header.

function handleError(res, error) {
  if (error && error.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error('[groups]', error);
  return res.status(500).json({ error: 'Interner Fehler' });
}

async function loadCtx(req, res) {
  const ctx = await loadUserGroupContext(db, req.user.sub);
  if (!ctx) {
    res.status(401).json({ error: 'Benutzer nicht gefunden' });
    return null;
  }
  return ctx;
}

// ============ GROUPS ============

router.get('/', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    const groups = await listUserGroups(db, ctx);
    res.json({ groups });
  } catch (err) {
    handleError(res, err);
  }
});

// ============ VISIBLE SHIFTS (read-only feed for department schedule) ============
// Returns all shared shift entries that should appear in the active tenant's
// schedule view. The active tenant is resolved from the x-db-token header.
// Every shift carries a `canWrite` flag derived from the user's group admin rights.
router.get('/visible-shifts', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;

    const activeTenantId = await resolveTenantIdFromToken(db, req.headers['x-db-token']);
    if (!activeTenantId) {
      // No tenant context → nothing to show. This is not an error: pool view works
      // only when a tenant is active in the switcher.
      return res.json({ shifts: [], tenantId: null, groupIds: [] });
    }

    const accessibleGroupIds = await loadVisibleGroupIdsForTenant(db, ctx, activeTenantId);
    if (accessibleGroupIds.length === 0) {
      return res.json({ shifts: [], workplaces: [], tenantId: activeTenantId, groupIds: [] });
    }

    const { from, to } = req.query;
    const dateFilter = [];
    const dateParams = [];
    if (from) {
      dateFilter.push('s.date >= ?');
      dateParams.push(from);
    }
    if (to) {
      dateFilter.push('s.date <= ?');
      dateParams.push(to);
    }
    const dateWhere = dateFilter.length > 0 ? `AND ${dateFilter.join(' AND ')}` : '';

    const placeholders = accessibleGroupIds.map(() => '?').join(',');

    // Load all active workplaces in the accessible groups (independent of shift presence)
    const [workplaceRows] = await db.execute(
      `SELECT id, group_id, name, category, start_time, end_time, affects_availability,
              min_staff, optimal_staff
         FROM shared_workplace
        WHERE group_id IN (${placeholders})
          AND is_active = 1
        ORDER BY name ASC`,
      accessibleGroupIds
    );
    const workplaces = workplaceRows.map((r) => ({
      id: r.id,
      group_id: Number(r.group_id),
      name: r.name,
      category: r.category,
      start_time: r.start_time,
      end_time: r.end_time,
      affects_availability: Boolean(r.affects_availability),
      min_staff: r.min_staff,
      optimal_staff: r.optimal_staff,
      canWrite: canWriteShiftInGroup(ctx, r.group_id),
    }));

    const [shiftRows] = await db.execute(
      `SELECT s.id,
              s.shared_workplace_id,
              s.date,
              s.employee_id,
              s.billing_tenant_id,
              s.start_time,
              s.end_time,
              s.note,
              w.group_id,
              w.name AS workplace_name,
              w.category AS workplace_category,
              w.affects_availability,
              e.first_name,
                  e.last_name
         FROM shared_shift_entry s
         JOIN shared_workplace w ON w.id = s.shared_workplace_id
          LEFT JOIN Employee e
            ON e.id COLLATE utf8mb4_general_ci = s.employee_id COLLATE utf8mb4_general_ci
        WHERE w.group_id IN (${placeholders})
          AND w.is_active = 1
          ${dateWhere}
        ORDER BY s.date ASC, w.name ASC`,
      [...accessibleGroupIds, ...dateParams]
    );

    const shifts = shiftRows.map((r) => {
      const employeeName = [r.first_name, r.last_name].filter(Boolean).join(' ')
        || `#${r.employee_id}`;
      return {
        id: r.id,
        shared_workplace_id: r.shared_workplace_id,
        group_id: Number(r.group_id),
        date: r.date,
        employee_id: r.employee_id,
        employee_name: employeeName,
        billing_tenant_id: r.billing_tenant_id ? String(r.billing_tenant_id) : null,
        belongs_to_active_tenant: r.billing_tenant_id != null && String(r.billing_tenant_id) === activeTenantId,
        workplace_name: r.workplace_name,
        workplace_category: r.workplace_category,
        affects_availability: Boolean(r.affects_availability),
        start_time: r.start_time,
        end_time: r.end_time,
        note: r.note,
        canWrite: canWriteShiftInGroup(ctx, r.group_id),
      };
    });

    res.json({
      shifts,
      workplaces,
      tenantId: activeTenantId,
      groupIds: accessibleGroupIds,
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:groupId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    const group = await requireGroupReadAccess(db, ctx, req.params.groupId);
    res.json({ group });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/', adminMiddleware, async (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name ist erforderlich' });
    }
    const [result] = await db.execute(
      'INSERT INTO tenant_group (name, description) VALUES (?, ?)',
      [name.trim(), description || null]
    );
    const [rows] = await db.execute('SELECT id, name, description, is_active FROM tenant_group WHERE id = ?', [result.insertId]);
    res.status(201).json({ group: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Verbund mit diesem Namen existiert bereits' });
    }
    handleError(res, err);
  }
});

router.patch('/:groupId', adminMiddleware, async (req, res) => {
  try {
    const { name, description, is_active } = req.body || {};
    const fields = [];
    const values = [];
    if (typeof name === 'string' && name.trim().length > 0) {
      fields.push('name = ?');
      values.push(name.trim());
    }
    if (description !== undefined) {
      fields.push('description = ?');
      values.push(description || null);
    }
    if (typeof is_active === 'boolean') {
      fields.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'Keine Änderungen' });
    }
    values.push(Number(req.params.groupId));
    await db.execute(`UPDATE tenant_group SET ${fields.join(', ')} WHERE id = ?`, values);
    const [rows] = await db.execute('SELECT id, name, description, is_active FROM tenant_group WHERE id = ?', [req.params.groupId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Verbund nicht gefunden' });
    res.json({ group: rows[0] });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:groupId', adminMiddleware, async (req, res) => {
  try {
    await db.execute('DELETE FROM tenant_group WHERE id = ?', [req.params.groupId]);
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ============ MEMBERS ============

router.get('/:groupId/members', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const [rows] = await db.execute(
      `SELECT m.tenant_id, m.role, t.name, t.host, t.db_name
         FROM tenant_group_member m
         JOIN db_tokens t ON t.id = m.tenant_id
        WHERE m.group_id = ?
        ORDER BY t.name ASC`,
      [req.params.groupId]
    );
    res.json({ members: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:groupId/members', adminMiddleware, async (req, res) => {
  try {
    const { tenant_id, role } = req.body || {};
    if (!tenant_id) return res.status(400).json({ error: 'tenant_id ist erforderlich' });
    const tenantRole = role === 'observer' ? 'observer' : 'member';
    await db.execute(
      'INSERT IGNORE INTO tenant_group_member (group_id, tenant_id, role) VALUES (?, ?, ?)',
      [req.params.groupId, tenant_id, tenantRole]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:groupId/members/:tenantId', adminMiddleware, async (req, res) => {
  try {
    await db.execute(
      'DELETE FROM tenant_group_member WHERE group_id = ? AND tenant_id = ?',
      [req.params.groupId, req.params.tenantId]
    );
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ============ WORKPLACES ============

router.get('/:groupId/workplaces', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const [rows] = await db.execute(
      `SELECT id, name, category, start_time, end_time, active_days,
              allows_multiple, min_staff, optimal_staff, default_overlap_tolerance_minutes,
              work_time_percentage, service_type, auto_off, allows_rotation_concurrently,
              affects_availability, allows_absence_overlap, timeslots_enabled,
              consecutive_days_mode, constraints_json, is_active
         FROM shared_workplace
        WHERE group_id = ?
        ORDER BY name ASC`,
      [req.params.groupId]
    );
    res.json({
      workplaces: rows.map((row) => ({
        ...row,
        allows_multiple: row.allows_multiple == null ? null : Boolean(row.allows_multiple),
        auto_off: Boolean(row.auto_off),
        allows_rotation_concurrently: Boolean(row.allows_rotation_concurrently),
        affects_availability: Boolean(row.affects_availability),
        allows_absence_overlap: Boolean(row.allows_absence_overlap),
        timeslots_enabled: Boolean(row.timeslots_enabled),
        is_active: Boolean(row.is_active),
        active_days: typeof row.active_days === 'string'
          ? (() => {
              try {
                return JSON.parse(row.active_days);
              } catch {
                return null;
              }
            })()
          : row.active_days,
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:groupId/workplaces', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const {
      name, start_time, end_time,
      active_days, allows_multiple, min_staff, optimal_staff, default_overlap_tolerance_minutes,
      work_time_percentage, service_type, auto_off, allows_rotation_concurrently,
      affects_availability, allows_absence_overlap, timeslots_enabled,
      consecutive_days_mode, constraints_json,
    } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name ist erforderlich' });
    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO shared_workplace
         (id, group_id, name, category, start_time, end_time, active_days, allows_multiple,
          min_staff, optimal_staff, default_overlap_tolerance_minutes, work_time_percentage,
          service_type, auto_off, allows_rotation_concurrently, affects_availability,
          allows_absence_overlap, timeslots_enabled, consecutive_days_mode, constraints_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, Number(req.params.groupId), name, 'Dienste',
        start_time || null, end_time || null,
        Array.isArray(active_days) ? JSON.stringify(active_days) : null,
        typeof allows_multiple === 'boolean' ? (allows_multiple ? 1 : 0) : 0,
        Number.isInteger(min_staff) ? min_staff : 1,
        Number.isInteger(optimal_staff) ? optimal_staff : 1,
        Number.isInteger(default_overlap_tolerance_minutes) ? default_overlap_tolerance_minutes : 15,
        typeof work_time_percentage === 'number' ? work_time_percentage : 100,
        Number.isInteger(service_type) ? service_type : null,
        auto_off ? 1 : 0,
        allows_rotation_concurrently ? 1 : 0,
        affects_availability === false ? 0 : 1,
        allows_absence_overlap ? 1 : 0,
        timeslots_enabled ? 1 : 0,
        consecutive_days_mode || 'allowed',
        constraints_json ? JSON.stringify(constraints_json) : null,
        req.user.email || req.user.sub,
      ]
    );
    res.status(201).json({ id });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/:groupId/workplaces/:workplaceId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const allowed = ['name', 'start_time', 'end_time',
      'active_days', 'allows_multiple', 'min_staff', 'optimal_staff', 'default_overlap_tolerance_minutes',
      'work_time_percentage', 'service_type', 'auto_off', 'allows_rotation_concurrently',
      'affects_availability', 'allows_absence_overlap', 'timeslots_enabled',
      'consecutive_days_mode', 'constraints_json', 'is_active'];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      let val = req.body[key];
      if (key === 'active_days' && Array.isArray(val)) {
        val = JSON.stringify(val);
      }
      if (key === 'constraints_json' && val && typeof val !== 'string') {
        val = JSON.stringify(val);
      }
      if (['allows_multiple', 'auto_off', 'allows_rotation_concurrently', 'affects_availability', 'allows_absence_overlap', 'timeslots_enabled', 'is_active'].includes(key)) {
        val = val ? 1 : 0;
      }
      fields.push(`${key} = ?`);
      values.push(val);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Keine Änderungen' });
    values.push(req.params.workplaceId, Number(req.params.groupId));
    await db.execute(
      `UPDATE shared_workplace SET ${fields.join(', ')} WHERE id = ? AND group_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:groupId/workplaces/:workplaceId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    await db.execute(
      'DELETE FROM shared_workplace WHERE id = ? AND group_id = ?',
      [req.params.workplaceId, req.params.groupId]
    );
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:groupId/workplaces/:workplaceId/timeslots', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const [rows] = await db.execute(
      `SELECT id, shared_workplace_id, label, start_time, end_time,
              \`order\` AS sort_order, overlap_tolerance_minutes, spans_midnight
         FROM shared_workplace_timeslot
        WHERE shared_workplace_id = ?
        ORDER BY COALESCE(\`order\`, 0) ASC, start_time ASC`,
      [req.params.workplaceId]
    );
    res.json({
      timeslots: rows.map((row) => ({
        ...row,
        order: row.sort_order ?? 0,
        spans_midnight: Boolean(row.spans_midnight),
      })),
    });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/:groupId/workplaces/:workplaceId/timeslots', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const { label, start_time, end_time, order, overlap_tolerance_minutes, spans_midnight } = req.body || {};
    if (!label || !start_time || !end_time) {
      return res.status(400).json({ error: 'label, start_time und end_time sind erforderlich' });
    }
    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO shared_workplace_timeslot
        (id, shared_workplace_id, label, start_time, end_time,
         \`order\`, overlap_tolerance_minutes, spans_midnight, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.params.workplaceId,
        label,
        start_time,
        end_time,
        Number.isInteger(order) ? order : 0,
        Number.isInteger(overlap_tolerance_minutes) ? overlap_tolerance_minutes : 0,
        spans_midnight ? 1 : 0,
        req.user.email || req.user.sub,
      ]
    );
    res.status(201).json({ id });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/:groupId/workplaces/:workplaceId/timeslots/:timeslotId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const allowed = ['label', 'start_time', 'end_time', 'order', 'overlap_tolerance_minutes', 'spans_midnight'];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      let val = req.body[key];
      if (key === 'spans_midnight') {
        val = val ? 1 : 0;
      }
      const columnName = key === 'order' ? '\`order\`' : key;
      fields.push(`${columnName} = ?`);
      values.push(val);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Keine Änderungen' });
    values.push(req.params.timeslotId, req.params.workplaceId);
    await db.execute(
      `UPDATE shared_workplace_timeslot SET ${fields.join(', ')}
        WHERE id = ? AND shared_workplace_id = ?`,
      values
    );
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:groupId/workplaces/:workplaceId/timeslots/:timeslotId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    await db.execute(
      'DELETE FROM shared_workplace_timeslot WHERE id = ? AND shared_workplace_id = ?',
      [req.params.timeslotId, req.params.workplaceId]
    );
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ============ QUOTAS ============

router.get('/:groupId/workplaces/:workplaceId/quotas', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const [rows] = await db.execute(
      `SELECT q.shared_workplace_id, q.scope, q.scope_key, q.period,
              q.max_count, q.target_count, q.weight
         FROM shared_workplace_quota q
         JOIN shared_workplace w ON w.id = q.shared_workplace_id
        WHERE w.group_id = ? AND w.id = ?`,
      [req.params.groupId, req.params.workplaceId]
    );
    res.json({ quotas: rows });
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/:groupId/workplaces/:workplaceId/quotas', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const quotas = Array.isArray(req.body?.quotas) ? req.body.quotas : null;
    if (!quotas) return res.status(400).json({ error: 'quotas[] erforderlich' });

    // Replace-strategy: delete all for this workplace, then insert fresh.
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM shared_workplace_quota WHERE shared_workplace_id = ?', [req.params.workplaceId]);
      for (const q of quotas) {
        if (!['person', 'tenant', 'role'].includes(q.scope)) continue;
        if (!q.scope_key) continue;
        const period = ['month', 'quarter', 'year'].includes(q.period) ? q.period : 'month';
        await conn.execute(
          `INSERT INTO shared_workplace_quota
             (shared_workplace_id, scope, scope_key, period, max_count, target_count, weight)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            req.params.workplaceId, q.scope, String(q.scope_key), period,
            q.max_count ?? null, q.target_count ?? null,
            q.weight ?? 1.0,
          ]
        );
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

// ============ STAFF (aggregated employees in the group) ============

router.get('/:groupId/staff', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const tenantIds = await loadGroupTenantIds(db, req.params.groupId);
    if (tenantIds.length === 0) return res.json({ staff: [] });

    // Employees assigned to any tenant in the group, with their primary
    // tenant and an aggregated tenant list. Names come from Employee
    // (central identity); roles come from the per-tenant Doctor row but
    // those live in tenant DBs — for now we return central data only and
    // let the frontend optionally fetch per-tenant role via existing routes.
    const placeholders = tenantIds.map(() => '?').join(',');
    const [rows] = await db.execute(
      `SELECT e.id, e.last_name, e.first_name, e.payroll_id, e.is_active,
              GROUP_CONCAT(DISTINCT eta.tenant_id) AS tenant_ids,
              MAX(CASE WHEN eta.is_primary THEN eta.tenant_id END) AS primary_tenant_id
         FROM Employee e
         JOIN EmployeeTenantAssignment eta
           ON eta.employee_id COLLATE utf8mb4_general_ci = e.id COLLATE utf8mb4_general_ci
        WHERE eta.tenant_id IN (${placeholders})
          AND e.is_active = 1
        GROUP BY e.id
        ORDER BY e.last_name, e.first_name`,
      tenantIds.map(String)
    );

    const staff = rows.map((r) => ({
      id: r.id,
      last_name: r.last_name,
      first_name: r.first_name,
      payroll_id: r.payroll_id,
      is_active: !!r.is_active,
      tenant_ids: r.tenant_ids ? String(r.tenant_ids).split(',') : [],
      primary_tenant_id: r.primary_tenant_id ? String(r.primary_tenant_id) : null,
    }));

    res.json({ staff });
  } catch (err) {
    handleError(res, err);
  }
});

// ============ SCHEDULE (pool shifts only) ============

router.get('/:groupId/schedule', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'from/to (YYYY-MM-DD) erforderlich' });
    }
    const [rows] = await db.execute(
      `SELECT s.id, s.shared_workplace_id, s.date, s.employee_id, s.billing_tenant_id,
              s.start_time, s.end_time, s.note,
              w.name AS workplace_name, w.category AS workplace_category
         FROM shared_shift_entry s
         JOIN shared_workplace w ON w.id = s.shared_workplace_id
        WHERE w.group_id = ?
          AND s.date BETWEEN ? AND ?
        ORDER BY s.date ASC, w.name ASC`,
      [req.params.groupId, from, to]
    );
    res.json({ shifts: rows });
  } catch (err) {
    handleError(res, err);
  }
});

// ============ SHIFTS (write) ============

/**
 * Load existing shifts for a workplace covering the relevant window for
 * constraint evaluation.
 */
async function loadShiftsWindow(workplaceId, dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - 7);
  const end = new Date(date);
  end.setUTCDate(end.getUTCDate() + 7);
  // also cover the whole calendar month for max_per_person_month
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  const lo = (start < monthStart ? start : monthStart).toISOString().slice(0, 10);
  const hi = (end > monthEnd ? end : monthEnd).toISOString().slice(0, 10);
  const [rows] = await db.execute(
    `SELECT id, date, employee_id FROM shared_shift_entry
       WHERE shared_workplace_id = ? AND date BETWEEN ? AND ?`,
    [workplaceId, lo, hi]
  );
  return rows.map((r) => ({ ...r, date: String(r.date).slice(0, 10) }));
}

router.post('/:groupId/shifts', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const { shared_workplace_id, date, employee_id, billing_tenant_id, start_time, end_time, note } = req.body || {};
    if (!shared_workplace_id || !date || !employee_id || !billing_tenant_id) {
      return res.status(400).json({ error: 'shared_workplace_id, date, employee_id, billing_tenant_id erforderlich' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date muss YYYY-MM-DD sein' });
    }

    // Verify workplace belongs to the group
    const [wpRows] = await db.execute(
      'SELECT id, name, min_staff, optimal_staff, constraints_json FROM shared_workplace WHERE id = ? AND group_id = ? AND is_active = 1',
      [shared_workplace_id, req.params.groupId]
    );
    if (wpRows.length === 0) return res.status(404).json({ error: 'Workplace nicht gefunden' });
    const workplace = wpRows[0];

    // Constraint check
    const existing = await loadShiftsWindow(shared_workplace_id, date);
    const violations = validateProposedShift({
      workplace,
      proposed: { date, employee_id, employee_role: req.body.employee_role || null },
      existingForWorkplace: existing,
    });
    // Hard violations (max_per_person_month, max_consecutive, rest_after) block the save.
    const hardRules = new Set(['max_per_person_month', 'max_consecutive', 'rest_after']);
    const hard = violations.filter((v) => hardRules.has(v.rule));
    if (hard.length > 0 && req.query.force !== '1') {
      return res.status(422).json({ error: 'constraint_violation', details: hard });
    }

    const id = crypto.randomUUID();
    await db.execute(
      `INSERT INTO shared_shift_entry
         (id, shared_workplace_id, date, employee_id, billing_tenant_id, start_time, end_time, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, shared_workplace_id, date, employee_id, String(billing_tenant_id),
       start_time || null, end_time || null, note || null,
       req.user.email || req.user.sub]
    );
    res.status(201).json({ id, warnings: violations.filter((v) => !hardRules.has(v.rule)) });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/:groupId/shifts/:shiftId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const allowed = ['date', 'employee_id', 'billing_tenant_id', 'start_time', 'end_time', 'note'];
    const fields = [];
    const values = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      let value = req.body[key];
      if (key === 'billing_tenant_id' && value != null) {
        value = String(value);
      }
      fields.push(`${key} = ?`);
      values.push(value);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Keine Änderungen' });

    // Verify shift belongs to a workplace in this group
    const [rows] = await db.execute(
      `SELECT s.id FROM shared_shift_entry s
         JOIN shared_workplace w ON w.id = s.shared_workplace_id
        WHERE s.id = ? AND w.group_id = ?`,
      [req.params.shiftId, req.params.groupId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Schicht nicht gefunden' });

    values.push(req.params.shiftId);
    await db.execute(`UPDATE shared_shift_entry SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:groupId/shifts/:shiftId', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    requireGroupWriteAccess(ctx, req.params.groupId);
    const [result] = await db.execute(
      `DELETE s FROM shared_shift_entry s
         JOIN shared_workplace w ON w.id = s.shared_workplace_id
        WHERE s.id = ? AND w.group_id = ?`,
      [req.params.shiftId, req.params.groupId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Schicht nicht gefunden' });
    res.status(204).end();
  } catch (err) {
    handleError(res, err);
  }
});

// ============ STATS ============

router.get('/:groupId/stats', async (req, res) => {
  try {
    const ctx = await loadCtx(req, res);
    if (!ctx) return;
    await requireGroupReadAccess(db, ctx, req.params.groupId);
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'from/to (YYYY-MM-DD) erforderlich' });
    }

    // Counts per workplace + tenant
    const [perTenant] = await db.execute(
      `SELECT w.id AS workplace_id, w.name AS workplace_name,
              s.billing_tenant_id, t.name AS tenant_name,
              COUNT(*) AS cnt
         FROM shared_shift_entry s
         JOIN shared_workplace w ON w.id = s.shared_workplace_id
         JOIN db_tokens t ON t.id = s.billing_tenant_id
        WHERE w.group_id = ? AND s.date BETWEEN ? AND ?
        GROUP BY w.id, s.billing_tenant_id
        ORDER BY w.name, t.name`,
      [req.params.groupId, from, to]
    );

    // Counts per workplace + person
    const [perPerson] = await db.execute(
      `SELECT w.id AS workplace_id, w.name AS workplace_name,
              s.employee_id, e.last_name, e.first_name,
              COUNT(*) AS cnt
         FROM shared_shift_entry s
         JOIN shared_workplace w ON w.id = s.shared_workplace_id
         LEFT JOIN Employee e
                ON e.id COLLATE utf8mb4_general_ci = s.employee_id COLLATE utf8mb4_general_ci
        WHERE w.group_id = ? AND s.date BETWEEN ? AND ?
        GROUP BY w.id, s.employee_id
        ORDER BY w.name, cnt DESC`,
      [req.params.groupId, from, to]
    );

    res.json({ per_tenant: perTenant, per_person: perPerson });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
