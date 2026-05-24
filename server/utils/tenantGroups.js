/**
 * Helpers for tenant_group (cross-department pool) feature.
 *
 * All data lives in the master DB (see docs/features/TENANT_GROUPS.md).
 * These helpers parse JSON columns from app_users, resolve group
 * membership, and centralize permission checks.
 */

function parseJsonArray(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parse `allowed_groups` from an app_users row.
 * @returns {number[] | null} list of group ids; null means "no group access"
 */
export function parseAllowedGroups(raw) {
  const list = parseJsonArray(raw);
  if (!list) return null;
  const ids = list.map((v) => Number(v)).filter((n) => Number.isInteger(n));
  return ids.length > 0 ? ids : null;
}

/**
 * Parse `group_admin_groups` from an app_users row.
 * @returns {number[] | null}
 */
export function parseGroupAdminGroups(raw) {
  return parseAllowedGroups(raw);
}

/**
 * Load the full user record needed for group permission checks.
 */
export async function loadUserGroupContext(masterDb, userId) {
  const [rows] = await masterDb.execute(
    'SELECT id, role, allowed_groups, group_admin_groups FROM app_users WHERE id = ? AND is_active = 1',
    [userId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    role: row.role,
    isMasterAdmin: row.role === 'admin',
    allowedGroups: parseAllowedGroups(row.allowed_groups),
    adminGroups: parseGroupAdminGroups(row.group_admin_groups),
  };
}

/**
 * Check whether the user may read a given group.
 * Master admins always have access. Otherwise the group id must appear in
 * allowed_groups.
 */
export function canReadGroup(ctx, groupId) {
  if (!ctx) return false;
  if (ctx.isMasterAdmin) return true;
  const list = ctx.allowedGroups;
  return Array.isArray(list) && list.includes(Number(groupId));
}

/**
 * Check whether the user may modify pool data for a group.
 */
export function canWriteGroup(ctx, groupId) {
  if (!ctx) return false;
  if (ctx.isMasterAdmin) return true;
  const list = ctx.adminGroups;
  return Array.isArray(list) && list.includes(Number(groupId));
}

/**
 * Load every group the user is allowed to see.
 */
export async function listUserGroups(masterDb, ctx) {
  if (!ctx) return [];
  const [rows] = await masterDb.execute(
    `SELECT g.id, g.name, g.description, g.is_active
       FROM tenant_group g
      WHERE g.is_active = 1
      ORDER BY g.name ASC`
  );
  if (ctx.isMasterAdmin) return rows;
  const allowed = ctx.allowedGroups;
  if (!allowed) return [];
  return rows.filter((g) => allowed.includes(Number(g.id)));
}

/**
 * Load tenant ids that belong to a group.
 * Returns VARCHAR(36) UUID strings (matches db_tokens.id).
 */
export async function loadGroupTenantIds(masterDb, groupId) {
  const [rows] = await masterDb.execute(
    'SELECT tenant_id FROM tenant_group_member WHERE group_id = ?',
    [groupId]
  );
  return rows.map((r) => String(r.tenant_id));
}

/**
 * Throws an Error with `status` if the group does not exist or the user
 * lacks read permission. Returns the group row on success.
 */
export async function requireGroupReadAccess(masterDb, ctx, groupId) {
  const [rows] = await masterDb.execute(
    'SELECT id, name, description, is_active FROM tenant_group WHERE id = ?',
    [groupId]
  );
  if (rows.length === 0) {
    const err = new Error('Verbund nicht gefunden');
    err.status = 404;
    throw err;
  }
  if (!canReadGroup(ctx, groupId)) {
    const err = new Error('Kein Zugriff auf diesen Verbund');
    err.status = 403;
    throw err;
  }
  return rows[0];
}

/**
 * Throws if the user lacks write permission for the group.
 */
export function requireGroupWriteAccess(ctx, groupId) {
  if (!canWriteGroup(ctx, groupId)) {
    const err = new Error('Keine Schreibrechte für diesen Verbund');
    err.status = 403;
    throw err;
  }
}

/**
 * Resolve the db_tokens.id (VARCHAR(36) UUID) for a given raw token string.
 * Returns null when the token is absent or unknown.
 */
export async function resolveTenantIdFromToken(masterDb, dbToken) {
  if (!dbToken) return null;
  const [rows] = await masterDb.execute(
    'SELECT id FROM db_tokens WHERE token = ? LIMIT 1',
    [dbToken]
  );
  return rows.length > 0 ? String(rows[0].id) : null;
}

/**
 * Compute the set of group ids whose pool shifts the user may see while
 * viewing a given tenant. This is the intersection of:
 *   - groups the tenant participates in (tenant_group_member.tenant_id)
 *   - groups the user is allowed to read (ctx.allowedGroups or master admin)
 */
export async function loadVisibleGroupIdsForTenant(masterDb, ctx, tenantId) {
  if (!ctx || !tenantId) return [];
  const [rows] = await masterDb.execute(
    'SELECT group_id FROM tenant_group_member WHERE tenant_id = ?',
    [tenantId]
  );
  const groupIds = rows.map((r) => Number(r.group_id));
  if (ctx.isMasterAdmin) return groupIds;
  if (!Array.isArray(ctx.allowedGroups)) return [];
  return groupIds.filter((id) => ctx.allowedGroups.includes(id));
}

/**
 * Decide whether the user may write a pool shift that belongs to `groupId`.
 */
export function canWriteShiftInGroup(ctx, groupId) {
  if (!ctx) return false;
  if (ctx.isMasterAdmin) return true;
  return Array.isArray(ctx.adminGroups) && ctx.adminGroups.includes(Number(groupId));
}
