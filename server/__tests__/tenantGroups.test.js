import { describe, expect, it } from 'vitest';
import {
  parseAllowedGroups,
  parseGroupAdminGroups,
  canReadGroup,
  canWriteGroup,
  listUserGroups,
  resolveTenantIdFromToken,
  loadVisibleGroupIdsForTenant,
  canWriteShiftInGroup,
} from '../utils/tenantGroups.js';

describe('parseAllowedGroups', () => {
  it('returns null for empty input', () => {
    expect(parseAllowedGroups(null)).toBeNull();
    expect(parseAllowedGroups(undefined)).toBeNull();
    expect(parseAllowedGroups('')).toBeNull();
  });

  it('parses a JSON-string array of group ids', () => {
    expect(parseAllowedGroups('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('returns null for non-array JSON', () => {
    expect(parseAllowedGroups('{"a":1}')).toBeNull();
    expect(parseAllowedGroups('not json')).toBeNull();
  });

  it('accepts a native array', () => {
    expect(parseAllowedGroups([4, 5])).toEqual([4, 5]);
  });

  it('coerces string ids to numbers and drops invalid entries', () => {
    expect(parseAllowedGroups('["7", "x", 8]')).toEqual([7, 8]);
  });

  it('returns null when array yields no valid ids', () => {
    expect(parseAllowedGroups('["x", "y"]')).toBeNull();
  });
});

describe('parseGroupAdminGroups', () => {
  it('uses the same logic as parseAllowedGroups', () => {
    expect(parseGroupAdminGroups('[10]')).toEqual([10]);
    expect(parseGroupAdminGroups(null)).toBeNull();
  });
});

describe('canReadGroup', () => {
  it('returns false for null context', () => {
    expect(canReadGroup(null, 1)).toBe(false);
  });

  it('grants access to master admins regardless of allowedGroups', () => {
    const ctx = { isMasterAdmin: true, allowedGroups: null, adminGroups: null };
    expect(canReadGroup(ctx, 99)).toBe(true);
  });

  it('grants access when group id is in allowedGroups', () => {
    const ctx = { isMasterAdmin: false, allowedGroups: [1, 2], adminGroups: null };
    expect(canReadGroup(ctx, 2)).toBe(true);
  });

  it('denies access when group id is not in allowedGroups', () => {
    const ctx = { isMasterAdmin: false, allowedGroups: [1, 2], adminGroups: null };
    expect(canReadGroup(ctx, 3)).toBe(false);
  });

  it('denies non-admin users with null allowedGroups', () => {
    const ctx = { isMasterAdmin: false, allowedGroups: null, adminGroups: null };
    expect(canReadGroup(ctx, 1)).toBe(false);
  });
});

describe('canWriteGroup', () => {
  it('grants write access to master admins', () => {
    const ctx = { isMasterAdmin: true, allowedGroups: null, adminGroups: null };
    expect(canWriteGroup(ctx, 5)).toBe(true);
  });

  it('grants write only when group id is in adminGroups', () => {
    const ctx = { isMasterAdmin: false, allowedGroups: [1, 2], adminGroups: [1] };
    expect(canWriteGroup(ctx, 1)).toBe(true);
    expect(canWriteGroup(ctx, 2)).toBe(false);
  });

  it('denies read-only group members', () => {
    const ctx = { isMasterAdmin: false, allowedGroups: [1], adminGroups: null };
    expect(canWriteGroup(ctx, 1)).toBe(false);
  });
});

describe('listUserGroups', () => {
  function createMockMasterDb(rows) {
    return {
      async execute() {
        return [rows, []];
      },
    };
  }

  it('returns every active group for master admins', async () => {
    const db = createMockMasterDb([
      { id: 1, name: 'A', description: null, is_active: 1 },
      { id: 2, name: 'B', description: null, is_active: 1 },
    ]);
    const groups = await listUserGroups(db, {
      isMasterAdmin: true,
      allowedGroups: null,
      adminGroups: null,
    });
    expect(groups).toHaveLength(2);
  });

  it('filters by allowedGroups for non-admin users', async () => {
    const db = createMockMasterDb([
      { id: 1, name: 'A', description: null, is_active: 1 },
      { id: 2, name: 'B', description: null, is_active: 1 },
      { id: 3, name: 'C', description: null, is_active: 1 },
    ]);
    const groups = await listUserGroups(db, {
      isMasterAdmin: false,
      allowedGroups: [2],
      adminGroups: null,
    });
    expect(groups).toEqual([
      { id: 2, name: 'B', description: null, is_active: 1 },
    ]);
  });

  it('returns empty list when allowedGroups is null and user is not master admin', async () => {
    const db = createMockMasterDb([
      { id: 1, name: 'A', description: null, is_active: 1 },
    ]);
    const groups = await listUserGroups(db, {
      isMasterAdmin: false,
      allowedGroups: null,
      adminGroups: null,
    });
    expect(groups).toEqual([]);
  });

  it('returns empty list for null context', async () => {
    const db = createMockMasterDb([{ id: 1 }]);
    expect(await listUserGroups(db, null)).toEqual([]);
  });
});

describe('resolveTenantIdFromToken', () => {
  function dbWith(rows) {
    return { async execute() { return [rows, []]; } };
  }

  it('returns null when token is falsy', async () => {
    const db = dbWith([{ id: 'should-not-be-returned' }]);
    expect(await resolveTenantIdFromToken(db, null)).toBeNull();
    expect(await resolveTenantIdFromToken(db, '')).toBeNull();
    expect(await resolveTenantIdFromToken(db, undefined)).toBeNull();
  });

  it('returns null when no row matches', async () => {
    expect(await resolveTenantIdFromToken(dbWith([]), 'abc')).toBeNull();
  });

  it('returns the tenant id as string for a matching token', async () => {
    const db = dbWith([{ id: 'a1b2c3' }]);
    expect(await resolveTenantIdFromToken(db, 'some-token')).toBe('a1b2c3');
  });
});

describe('loadVisibleGroupIdsForTenant', () => {
  function dbWith(rows) {
    return { async execute() { return [rows, []]; } };
  }

  it('returns empty array for null ctx or missing tenantId', async () => {
    const db = dbWith([{ group_id: 1 }]);
    expect(await loadVisibleGroupIdsForTenant(db, null, 't1')).toEqual([]);
    expect(await loadVisibleGroupIdsForTenant(db, { isMasterAdmin: true }, null)).toEqual([]);
  });

  it('returns every membership group for master admins', async () => {
    const db = dbWith([{ group_id: 1 }, { group_id: 3 }]);
    const ctx = { isMasterAdmin: true, allowedGroups: null };
    expect(await loadVisibleGroupIdsForTenant(db, ctx, 't1')).toEqual([1, 3]);
  });

  it('intersects with allowedGroups for non-admin users', async () => {
    const db = dbWith([{ group_id: 1 }, { group_id: 2 }, { group_id: 3 }]);
    const ctx = { isMasterAdmin: false, allowedGroups: [2, 3, 99] };
    expect(await loadVisibleGroupIdsForTenant(db, ctx, 't1')).toEqual([2, 3]);
  });

  it('returns empty array when non-admin has no allowedGroups', async () => {
    const db = dbWith([{ group_id: 1 }]);
    const ctx = { isMasterAdmin: false, allowedGroups: null };
    expect(await loadVisibleGroupIdsForTenant(db, ctx, 't1')).toEqual([]);
  });
});

describe('canWriteShiftInGroup', () => {
  it('returns false for null ctx', () => {
    expect(canWriteShiftInGroup(null, 1)).toBe(false);
  });

  it('grants write to master admins for any group', () => {
    const ctx = { isMasterAdmin: true, adminGroups: null };
    expect(canWriteShiftInGroup(ctx, 42)).toBe(true);
  });

  it('grants write only when the group id is in adminGroups', () => {
    const ctx = { isMasterAdmin: false, adminGroups: [5, 7] };
    expect(canWriteShiftInGroup(ctx, 5)).toBe(true);
    expect(canWriteShiftInGroup(ctx, 6)).toBe(false);
  });

  it('denies write when adminGroups is null', () => {
    expect(canWriteShiftInGroup({ isMasterAdmin: false, adminGroups: null }, 1)).toBe(false);
  });
});
