import { describe, expect, it } from 'vitest';
import {
  migrateLinkedAssignmentsToCentral,
  listShiftEntriesWithCentralAbsences,
  migrateTenantDoctorAbsencesToCentral,
  previewTenantDoctorAbsenceMigration,
} from '../utils/centralAbsences.js';

function createListTenantDb() {
  return {
    async execute(sql, params = []) {
      if (sql.startsWith('SELECT * FROM ShiftEntry')) {
        expect(params).toEqual(['2026-01-01', '2026-01-31']);
        return [[
          { id: 'local-absence', doctor_id: 'doc-1', date: '2026-01-10', position: 'Urlaub' },
          { id: 'local-duty', doctor_id: 'doc-2', date: '2026-01-10', position: 'Dienst A' },
        ], []];
      }

      if (sql.includes('SELECT id, central_employee_id FROM Doctor')) {
        return [[
          { id: 'doc-1', central_employee_id: 'emp-1' },
        ], []];
      }

      throw new Error(`Unexpected tenant SQL: ${sql}`);
    },
  };
}

function createListMasterDb() {
  return {
    async execute(sql, params = []) {
      if (sql.includes('CREATE TABLE IF NOT EXISTS CentralAbsenceEntry')) {
        return [[], []];
      }

      if (sql.startsWith('SELECT `id`, `employee_id`, `date`, `position`')) {
        expect(params).toEqual(['emp-1', '2026-01-01', '2026-01-31']);
        return [[
          {
            id: 'central-1',
            employee_id: 'emp-1',
            date: '2026-01-10',
            position: 'Urlaub',
            note: null,
            start_time: null,
            end_time: null,
            break_minutes: null,
            timeslot_id: null,
            order: null,
            created_date: '2026-01-01 09:00:00',
            updated_date: '2026-01-02 09:00:00',
            created_by: 'admin@example.com',
            source_tenant_id: 'tenant-1',
            source_tenant_doctor_id: 'doc-1',
          },
        ], []];
      }

      throw new Error(`Unexpected master SQL: ${sql}`);
    },
  };
}

function createMigrationTenantDb() {
  const calls = [];

  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });

      if (sql.startsWith('SELECT central_employee_id FROM Doctor')) {
        return [[{ central_employee_id: 'emp-1' }], []];
      }

      if (sql.startsWith('SELECT * FROM ShiftEntry WHERE doctor_id = ?')) {
        return [[
          { id: 'absence-1', doctor_id: 'doc-1', date: '2026-02-10', position: 'Urlaub', created_by: 'user@example.com' },
          { id: 'absence-2', doctor_id: 'doc-1', date: '2026-02-11', position: 'Krank', created_by: 'user@example.com' },
          { id: 'duty-1', doctor_id: 'doc-1', date: '2026-02-12', position: 'Frühdienst', created_by: 'user@example.com' },
        ], []];
      }

      if (sql.startsWith('DELETE FROM ShiftEntry')) {
        // Migration removes the newly imported row ('absence-1') AND the
        // redundant leftover whose exact central duplicate already exists
        // ('absence-2'). 'duty-1' is not an absence and stays. Other DELETE
        // shapes (e.g. the seed-back path) are handled by their own tests.
        expect([...params].sort()).toEqual(['absence-1', 'absence-2']);
        return [{ affectedRows: 2 }, []];
      }

      throw new Error(`Unexpected tenant SQL: ${sql}`);
    },
  };
}

function createMigrationMasterDb() {
  const calls = [];
  const existingDates = new Map([
    ['2026-02-10', []],
    ['2026-02-11', [{ id: 'already-central', position: 'Krank' }]],
  ]);

  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('CREATE TABLE IF NOT EXISTS CentralAbsenceEntry')) {
        return [[], []];
      }

      if (sql.startsWith('SELECT id, position FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ?')) {
        return [existingDates.get(params[1]) ?? [], []];
      }

      if (sql.startsWith('SELECT COUNT(*) AS total FROM CentralAbsenceEntry WHERE employee_id = ?')) {
        return [[{ total: 5 }], []];
      }

      if (sql.startsWith('INSERT INTO CentralAbsenceEntry')) {
        expect(params[0]).toBe('absence-1');
        expect(params[1]).toBe('emp-1');
        expect(params[2]).toBe('2026-02-10');
        expect(params[3]).toBe('Urlaub');
        return [{ affectedRows: 1 }, []];
      }

      if (sql.startsWith('SELECT `id`, `employee_id`, `date`, `position`')) {
        return [[
          {
            id: 'absence-1',
            employee_id: 'emp-1',
            date: '2026-02-10',
            position: 'Urlaub',
            note: null,
            start_time: null,
            end_time: null,
            break_minutes: null,
            timeslot_id: null,
            order: null,
            created_date: '2026-02-01 09:00:00',
            updated_date: '2026-02-01 09:00:00',
            created_by: 'user@example.com',
            source_tenant_id: 'tenant-1',
            source_tenant_doctor_id: 'doc-1',
          },
        ], []];
      }

      throw new Error(`Unexpected master SQL: ${sql}`);
    },
  };
}

describe('central absences', () => {
  it('merges central absences into tenant shift queries for linked doctors', async () => {
    const rows = await listShiftEntriesWithCentralAbsences({
      tenantDb: createListTenantDb(),
      masterDb: createListMasterDb(),
      filters: {
        date: {
          $gte: '2026-01-01',
          $lte: '2026-01-31',
        },
      },
      sort: 'date',
    });

    expect(rows).toEqual([
      {
        id: 'central-1',
        employee_id: 'emp-1',
        doctor_id: 'doc-1',
        date: '2026-01-10',
        position: 'Urlaub',
        note: null,
        start_time: null,
        end_time: null,
        break_minutes: null,
        timeslot_id: null,
        order: null,
        created_date: '2026-01-01 09:00:00',
        updated_date: '2026-01-02 09:00:00',
        created_by: 'admin@example.com',
        source_tenant_id: 'tenant-1',
        source_tenant_doctor_id: 'doc-1',
      },
      {
        id: 'local-duty',
        doctor_id: 'doc-2',
        date: '2026-01-10',
        position: 'Dienst A',
      },
    ]);
  });

  it('keeps not-yet-migrated local absences visible when no central duplicate exists', async () => {
    const tenantDb = {
      async execute(sql) {
        if (sql.startsWith('SELECT * FROM ShiftEntry')) {
          return [[
            { id: 'local-absence', doctor_id: 'doc-1', date: '2026-03-10', position: 'Urlaub' },
          ], []];
        }
        if (sql.includes('SELECT id, central_employee_id FROM Doctor')) {
          return [[{ id: 'doc-1', central_employee_id: 'emp-1' }], []];
        }
        throw new Error(`Unexpected tenant SQL: ${sql}`);
      },
    };
    const masterDb = {
      async execute(sql) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS CentralAbsenceEntry')) {
          return [[], []];
        }
        if (sql.startsWith('SELECT `id`, `employee_id`, `date`, `position`')) {
          return [[], []];
        }
        throw new Error(`Unexpected master SQL: ${sql}`);
      },
    };

    const rows = await listShiftEntriesWithCentralAbsences({ tenantDb, masterDb });

    expect(rows).toEqual([
      { id: 'local-absence', doctor_id: 'doc-1', date: '2026-03-10', position: 'Urlaub' },
    ]);
  });

  it('moves only missing tenant absences into the central store during linking', async () => {
    const tenantDb = createMigrationTenantDb();
    const masterDb = createMigrationMasterDb();

    const result = await migrateTenantDoctorAbsencesToCentral({
      tenantDb,
      masterDb,
      tenantId: 'tenant-1',
      doctorId: 'doc-1',
    });

    expect(result).toEqual({
      imported: 1,
      removedLocal: 2,
      skippedInvalidDate: [],
      localAbsences: 2,
      existingCentral: 1,
      centralTotal: 5,
      conflicts: 0,
      linkStatus: 'ok',
      linkRepaired: false,
    });
    expect(masterDb.calls.filter(({ sql }) => sql.startsWith('INSERT INTO CentralAbsenceEntry'))).toHaveLength(1);
  });

  it('skips invalid-date rows but still cleans up the rows it migrated', async () => {
    const inserts = [];
    const deleted = [];
    const tenantDb = {
      async execute(sql, params = []) {
        if (sql.startsWith('SELECT central_employee_id FROM Doctor')) {
          return [[{ central_employee_id: 'emp-1' }], []];
        }
        if (sql.startsWith('SELECT * FROM ShiftEntry WHERE doctor_id = ?')) {
          return [[
            { id: 'absence-bad', doctor_id: 'doc-1', date: null, position: 'Urlaub' },
            { id: 'absence-empty', doctor_id: 'doc-1', date: '', position: 'Krank' },
            { id: 'absence-good', doctor_id: 'doc-1', date: '2026-04-01', position: 'Frei' },
          ], []];
        }
        if (sql.startsWith('DELETE FROM ShiftEntry')) {
          deleted.push(...params);
          return [{ affectedRows: params.length }, []];
        }
        throw new Error(`Unexpected tenant SQL: ${sql}`);
      },
    };
    const masterDb = {
      async execute(sql, params = []) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS CentralAbsenceEntry')) {
          return [[], []];
        }
        if (sql.startsWith('SELECT id, position FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ?')) {
          return [[], []];
        }
        if (sql.startsWith('SELECT COUNT(*) AS total FROM CentralAbsenceEntry WHERE employee_id = ?')) {
          return [[{ total: 1 }], []];
        }
        if (sql.startsWith('INSERT INTO CentralAbsenceEntry')) {
          inserts.push(params);
          return [{ affectedRows: 1 }, []];
        }
        if (sql.startsWith('SELECT `id`, `employee_id`, `date`, `position`')) {
          return [[{
            id: params[0], employee_id: params[1], date: '2026-04-01', position: 'Frei',
            note: null, start_time: null, end_time: null, break_minutes: null,
            timeslot_id: null, order: null,
            created_date: '2026-04-01 09:00:00', updated_date: '2026-04-01 09:00:00',
            created_by: null, source_tenant_id: 'tenant-1', source_tenant_doctor_id: 'doc-1',
          }], []];
        }
        throw new Error(`Unexpected master SQL: ${sql}`);
      },
    };

    const result = await migrateTenantDoctorAbsencesToCentral({
      tenantDb,
      masterDb,
      tenantId: 'tenant-1',
      doctorId: 'doc-1',
    });

    // Valid rows are migrated AND their local copies are removed. Invalid-date
    // rows are reported and left in place for the admin to fix — they must NOT
    // block cleaning up the rows that are now safely stored centrally.
    expect(result).toEqual({
      imported: 1,
      removedLocal: 1,
      skippedInvalidDate: [
        { id: 'absence-bad', position: 'Urlaub', raw_date: null, reason: 'leer (null/undefined)' },
        { id: 'absence-empty', position: 'Krank', raw_date: '', reason: 'leerer String' },
      ],
      localAbsences: 3,
      existingCentral: 0,
      centralTotal: 1,
      conflicts: 0,
      linkStatus: 'ok',
      linkRepaired: false,
    });
    expect(inserts.map((params) => params[0])).toEqual(['absence-good']);
    expect(deleted).toEqual(['absence-good']);
  });

  it('logs the exact reason for each skipped invalid-date row', async () => {
    const warnLogs = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnLogs.push(args.join(' '));
    try {
      const tenantDb = {
        async execute(sql, params = []) {
          if (sql.startsWith('SELECT central_employee_id FROM Doctor')) {
            return [[{ central_employee_id: 'emp-7' }], []];
          }
          if (sql.startsWith('SELECT * FROM ShiftEntry WHERE doctor_id = ?')) {
            return [[
              { id: 'row-null', doctor_id: 'doc-7', date: null, position: 'Urlaub' },
              { id: 'row-garbage', doctor_id: 'doc-7', date: 'not-a-date', position: 'Krank' },
              { id: 'row-bad-day', doctor_id: 'doc-7', date: '2026-13-40', position: 'Frei' },
              { id: 'row-valid', doctor_id: 'doc-7', date: '2026-04-01', position: 'Frei' },
            ], []];
          }
          if (sql.startsWith('DELETE FROM ShiftEntry')) {
            return [{ affectedRows: params.length }, []];
          }
          throw new Error(`Unexpected tenant SQL: ${sql}`);
        },
      };
      const masterDb = {
        async execute(sql, params = []) {
          if (sql.includes('CREATE TABLE IF NOT EXISTS CentralAbsenceEntry')) return [[], []];
          if (sql.startsWith('SELECT id, position FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ?')) return [[], []];
          if (sql.startsWith('SELECT COUNT(*) AS total FROM CentralAbsenceEntry WHERE employee_id = ?')) return [[{ total: 1 }], []];
          if (sql.startsWith('INSERT INTO CentralAbsenceEntry')) return [{ affectedRows: 1 }, []];
          if (sql.startsWith('SELECT `id`, `employee_id`, `date`, `position`')) {
            return [[{
              id: params[0], employee_id: params[1], date: '2026-04-01', position: 'Frei',
              note: null, start_time: null, end_time: null, break_minutes: null,
              timeslot_id: null, order: null,
              created_date: '2026-04-01 09:00:00', updated_date: '2026-04-01 09:00:00',
              created_by: null, source_tenant_id: 'tenant-1', source_tenant_doctor_id: 'doc-7',
            }], []];
          }
          throw new Error(`Unexpected master SQL: ${sql}`);
        },
      };

      const result = await migrateTenantDoctorAbsencesToCentral({
        tenantDb,
        masterDb,
        tenantId: 'tenant-1',
        doctorId: 'doc-7',
      });

      expect(result.skippedInvalidDate.map((entry) => entry.id)).toEqual(['row-null', 'row-garbage', 'row-bad-day']);
      expect(result.skippedInvalidDate.map((entry) => entry.reason)).toEqual([
        'leer (null/undefined)',
        expect.stringMatching(/unerwartetes Datumsformat/),
        expect.stringMatching(/kein gültiges Kalenderdatum/),
      ]);
      expect(warnLogs.length).toBe(3);
      expect(warnLogs[0]).toMatch(/row_id=row-null/);
      expect(warnLogs[0]).toMatch(/raw_date=null/);
      expect(warnLogs[0]).toMatch(/reason="leer \(null\/undefined\)"/);
      expect(warnLogs[1]).toMatch(/row_id=row-garbage/);
      expect(warnLogs[1]).toMatch(/raw_date="not-a-date"/);
      expect(warnLogs[2]).toMatch(/row_id=row-bad-day/);
      expect(warnLogs[2]).toMatch(/raw_date="2026-13-40"/);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('treats lowercase and umlaut-stripped positions as absences', async () => {
    const tenantDb = {
      async execute(sql, params = []) {
        if (sql.startsWith('SELECT central_employee_id FROM Doctor')) {
          return [[{ central_employee_id: 'emp-1' }], []];
        }
        if (sql.startsWith('SELECT * FROM ShiftEntry WHERE doctor_id = ?')) {
          return [[
            { id: 'lower-urlaub', doctor_id: 'doc-1', date: '2026-05-10', position: 'urlaub' },
            { id: 'strip-umlaute', doctor_id: 'doc-1', date: '2026-05-11', position: 'nicht verfuegbar' },
            { id: 'pascal-fortbildung', doctor_id: 'doc-1', date: '2026-05-12', position: 'Fortbildung' },
            { id: 'not-absence', doctor_id: 'doc-1', date: '2026-05-13', position: 'Frühdienst' },
          ], []];
        }
        if (sql.startsWith('DELETE FROM ShiftEntry')) {
          // Only the three absence-position rows should be deleted, by id.
          expect(params.sort()).toEqual(['lower-urlaub', 'pascal-fortbildung', 'strip-umlaute']);
          return [{ affectedRows: 3 }, []];
        }
        throw new Error(`Unexpected tenant SQL: ${sql}`);
      },
    };
    const masterDb = {
      async execute(sql, params = []) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS CentralAbsenceEntry')) {
          return [[], []];
        }
        if (sql.startsWith('SELECT id, position FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ?')) {
          return [[], []];
        }
        if (sql.startsWith('SELECT COUNT(*) AS total FROM CentralAbsenceEntry WHERE employee_id = ?')) {
          return [[{ total: 3 }], []];
        }
        if (sql.startsWith('INSERT INTO CentralAbsenceEntry')) {
          return [{ affectedRows: 1 }, []];
        }
        if (sql.startsWith('SELECT `id`, `employee_id`, `date`, `position`')) {
          return [[{
            id: params[0], employee_id: params[1], date: '2026-05-10', position: 'urlaub',
            note: null, start_time: null, end_time: null, break_minutes: null,
            timeslot_id: null, order: null,
            created_date: '2026-05-10 09:00:00', updated_date: '2026-05-10 09:00:00',
            created_by: null, source_tenant_id: 'tenant-1', source_tenant_doctor_id: 'doc-1',
          }], []];
        }
        throw new Error(`Unexpected master SQL: ${sql}`);
      },
    };

    const result = await migrateTenantDoctorAbsencesToCentral({
      tenantDb,
      masterDb,
      tenantId: 'tenant-1',
      doctorId: 'doc-1',
    });

    expect(result).toEqual({
      imported: 3,
      removedLocal: 3,
      skippedInvalidDate: [],
      localAbsences: 3,
      existingCentral: 0,
      centralTotal: 3,
      conflicts: 0,
      linkStatus: 'ok',
      linkRepaired: false,
    });
  });

  it('normalizes the dedup key in the read-merge so case variants collapse', async () => {
    const tenantDb = {
      async execute(sql) {
        if (sql.startsWith('SELECT * FROM ShiftEntry')) {
          return [[
            { id: 'local-urlaub', doctor_id: 'doc-1', date: '2026-06-10', position: 'urlaub' },
            { id: 'local-duty', doctor_id: 'doc-2', date: '2026-06-10', position: 'Dienst A' },
          ], []];
        }
        if (sql.includes('SELECT id, central_employee_id FROM Doctor')) {
          return [[{ id: 'doc-1', central_employee_id: 'emp-1' }], []];
        }
        throw new Error(`Unexpected tenant SQL: ${sql}`);
      },
    };
    const masterDb = {
      async execute(sql) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS CentralAbsenceEntry')) {
          return [[], []];
        }
        if (sql.startsWith('SELECT `id`, `employee_id`, `date`, `position`')) {
          // Central row is PascalCase; the local row is lowercase. The dedup
          // must recognize them as the same absence.
          return [[{
            id: 'central-1', employee_id: 'emp-1', date: '2026-06-10', position: 'Urlaub',
            note: null, start_time: null, end_time: null, break_minutes: null,
            timeslot_id: null, order: null,
            created_date: '2026-06-10 09:00:00', updated_date: '2026-06-10 09:00:00',
            created_by: null, source_tenant_id: 'tenant-1', source_tenant_doctor_id: 'doc-1',
          }], []];
        }
        throw new Error(`Unexpected master SQL: ${sql}`);
      },
    };

    const rows = await listShiftEntriesWithCentralAbsences({ tenantDb, masterDb });

    // local-urlaub must be hidden because the normalized key matches the
    // central row. local-duty stays visible.
    expect(rows).toEqual([
      {
        id: 'central-1',
        employee_id: 'emp-1',
        doctor_id: 'doc-1',
        date: '2026-06-10',
        position: 'Urlaub',
        note: null, start_time: null, end_time: null, break_minutes: null,
        timeslot_id: null, order: null,
        created_date: '2026-06-10 09:00:00', updated_date: '2026-06-10 09:00:00',
        created_by: null, source_tenant_id: 'tenant-1', source_tenant_doctor_id: 'doc-1',
      },
      { id: 'local-duty', doctor_id: 'doc-2', date: '2026-06-10', position: 'Dienst A' },
    ]);
  });

  it('repairs a missing tenant link from the master assignment and migrates', async () => {
    const calls = [];
    const tenantDb = {
      calls,
      async execute(sql, params = []) {
        calls.push({ sql, params });
        if (sql.startsWith('SELECT central_employee_id FROM Doctor')) {
          // Master says this doctor is linked, but the tenant Doctor row has
          // no central_employee_id yet (master/tenant link drift).
          return [[{ central_employee_id: null }], []];
        }
        if (sql.startsWith('UPDATE Doctor SET central_employee_id = ?')) {
          return [{ affectedRows: 1 }, []];
        }
        if (sql.startsWith('SELECT * FROM ShiftEntry WHERE doctor_id = ?')) {
          return [[
            { id: 'absence-x', doctor_id: 'doc-9', date: '2026-07-01', position: 'Urlaub', created_by: 'user@example.com' },
          ], []];
        }
        if (sql.startsWith('DELETE FROM ShiftEntry')) {
          expect(params).toEqual(['absence-x']);
          return [{ affectedRows: 1 }, []];
        }
        throw new Error(`Unexpected tenant SQL: ${sql}`);
      },
    };
    const masterDb = {
      async execute(sql, params = []) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS CentralAbsenceEntry')) {
          return [[], []];
        }
        if (sql.startsWith('SELECT id, position FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ?')) {
          return [[], []];
        }
        if (sql.startsWith('SELECT COUNT(*) AS total FROM CentralAbsenceEntry WHERE employee_id = ?')) {
          return [[{ total: 1 }], []];
        }
        if (sql.startsWith('INSERT INTO CentralAbsenceEntry')) {
          expect(params[1]).toBe('emp-9');
          return [{ affectedRows: 1 }, []];
        }
        if (sql.startsWith('SELECT `id`, `employee_id`, `date`, `position`')) {
          return [[{
            id: params[0], employee_id: params[1], date: '2026-07-01', position: 'Urlaub',
            note: null, start_time: null, end_time: null, break_minutes: null,
            timeslot_id: null, order: null,
            created_date: '2026-07-01 09:00:00', updated_date: '2026-07-01 09:00:00',
            created_by: null, source_tenant_id: 'tenant-1', source_tenant_doctor_id: 'doc-9',
          }], []];
        }
        throw new Error(`Unexpected master SQL: ${sql}`);
      },
    };

    const result = await migrateTenantDoctorAbsencesToCentral({
      tenantDb,
      masterDb,
      tenantId: 'tenant-1',
      doctorId: 'doc-9',
      employeeId: 'emp-9',
    });

    expect(result).toEqual({
      imported: 1,
      removedLocal: 1,
      skippedInvalidDate: [],
      localAbsences: 1,
      existingCentral: 0,
      centralTotal: 1,
      conflicts: 0,
      linkStatus: 'repaired',
      linkRepaired: true,
    });
    // The tenant link must be repaired before deleting any local rows.
    const repair = calls.find(({ sql }) => sql.startsWith('UPDATE Doctor SET central_employee_id = ?'));
    expect(repair.params).toEqual(['emp-9', 'doc-9']);
  });

  it('reports tenant_doctor_missing when no matching Doctor row exists', async () => {
    const tenantDb = {
      async execute(sql) {
        if (sql.startsWith('SELECT central_employee_id FROM Doctor')) {
          return [[], []];
        }
        throw new Error(`Unexpected tenant SQL: ${sql}`);
      },
    };
    const masterDb = {
      async execute(sql) {
        throw new Error(`Master DB must not be touched: ${sql}`);
      },
    };

    const result = await migrateTenantDoctorAbsencesToCentral({
      tenantDb,
      masterDb,
      tenantId: 'tenant-1',
      doctorId: 'ghost',
      employeeId: 'emp-9',
    });

    expect(result).toEqual({
      imported: 0,
      removedLocal: 0,
      localAbsences: 0,
      existingCentral: 0,
      skippedInvalidDate: [],
      linkStatus: 'tenant_doctor_missing',
    });
  });

  it('preview reports repair_needed when the tenant link is missing', async () => {
    const tenantDb = {
      async execute(sql) {
        if (sql.startsWith('SELECT central_employee_id FROM Doctor')) {
          return [[{ central_employee_id: null }], []];
        }
        if (sql.startsWith('SELECT * FROM ShiftEntry WHERE doctor_id = ?')) {
          return [[
            { id: 'absence-x', doctor_id: 'doc-9', date: '2026-07-01', position: 'Urlaub' },
          ], []];
        }
        throw new Error(`Unexpected tenant SQL: ${sql}`);
      },
    };
    const masterDb = {
      async execute(sql) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS CentralAbsenceEntry')) {
          return [[], []];
        }
        if (sql.startsWith('SELECT COUNT(*) AS total FROM CentralAbsenceEntry WHERE employee_id = ?')) {
          return [[{ total: 0 }], []];
        }
        if (sql.startsWith('SELECT id, position FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ?')) {
          return [[], []];
        }
        throw new Error(`Unexpected master SQL: ${sql}`);
      },
    };

    const result = await previewTenantDoctorAbsenceMigration({
      tenantDb,
      masterDb,
      doctorId: 'doc-9',
      employeeId: 'emp-9',
    });

    expect(result).toEqual({
      imported: 1,
      removedLocal: 1,
      localAbsences: 1,
      existingCentral: 0,
      centralTotal: 0,
      conflicts: 0,
      skippedInvalidDate: [],
      linkStatus: 'repair_needed',
    });
  });

  it('reports centralTotal when a doctor is already fully migrated (0 local)', async () => {
    // Reproduces the "0/0/0 but absences exist" case: the local rows were
    // already moved to central in a prior run, so there is nothing left
    // locally — but the doctor still has central absences that the tenant
    // shows via the read-merge.
    const tenantDb = {
      async execute(sql) {
        if (sql.startsWith('SELECT central_employee_id FROM Doctor')) {
          return [[{ central_employee_id: 'emp-7' }], []];
        }
        if (sql.startsWith('SELECT * FROM ShiftEntry WHERE doctor_id = ?')) {
          return [[], []];
        }
        throw new Error(`Unexpected tenant SQL: ${sql}`);
      },
    };
    const masterDb = {
      async execute(sql) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS CentralAbsenceEntry')) {
          return [[], []];
        }
        if (sql.startsWith('SELECT COUNT(*) AS total FROM CentralAbsenceEntry WHERE employee_id = ?')) {
          return [[{ total: 47 }], []];
        }
        throw new Error(`Unexpected master SQL: ${sql}`);
      },
    };

    const result = await previewTenantDoctorAbsenceMigration({
      tenantDb,
      masterDb,
      doctorId: 'doc-7',
      employeeId: 'emp-7',
    });

    expect(result).toEqual({
      imported: 0,
      removedLocal: 0,
      localAbsences: 0,
      existingCentral: 0,
      centralTotal: 47,
      linkStatus: 'ok',
    });
  });

  it('cleans up redundant local rows and reports same-day conflicts', async () => {
    const deleted = [];
    const tenantDb = {
      async execute(sql, params = []) {
        if (sql.startsWith('SELECT central_employee_id FROM Doctor')) {
          return [[{ central_employee_id: 'emp-3' }], []];
        }
        if (sql.startsWith('SELECT * FROM ShiftEntry WHERE doctor_id = ?')) {
          return [[
            // Exact central duplicate → redundant, must be deleted.
            { id: 'dup', doctor_id: 'doc-3', date: '2026-08-01', position: 'Urlaub' },
            // Same day, different position → conflict, must stay local.
            { id: 'conflict', doctor_id: 'doc-3', date: '2026-08-02', position: 'Krank' },
            // No central row → newly imported.
            { id: 'new', doctor_id: 'doc-3', date: '2026-08-03', position: 'Frei' },
          ], []];
        }
        if (sql.startsWith('DELETE FROM ShiftEntry')) {
          deleted.push(...params);
          return [{ affectedRows: params.length }, []];
        }
        throw new Error(`Unexpected tenant SQL: ${sql}`);
      },
    };
    const central = new Map([
      ['2026-08-01', [{ id: 'c1', position: 'Urlaub' }]],
      ['2026-08-02', [{ id: 'c2', position: 'Dienstreise' }]],
      ['2026-08-03', []],
    ]);
    const masterDb = {
      async execute(sql, params = []) {
        if (sql.includes('CREATE TABLE IF NOT EXISTS CentralAbsenceEntry')) {
          return [[], []];
        }
        if (sql.startsWith('SELECT id, position FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ?')) {
          return [central.get(params[1]) ?? [], []];
        }
        if (sql.startsWith('SELECT COUNT(*) AS total FROM CentralAbsenceEntry WHERE employee_id = ?')) {
          return [[{ total: 2 }], []];
        }
        if (sql.startsWith('INSERT INTO CentralAbsenceEntry')) {
          return [{ affectedRows: 1 }, []];
        }
        if (sql.startsWith('SELECT `id`, `employee_id`, `date`, `position`')) {
          return [[{
            id: params[0], employee_id: params[1], date: '2026-08-03', position: 'Frei',
            note: null, start_time: null, end_time: null, break_minutes: null,
            timeslot_id: null, order: null,
            created_date: '2026-08-03 09:00:00', updated_date: '2026-08-03 09:00:00',
            created_by: null, source_tenant_id: 'tenant-1', source_tenant_doctor_id: 'doc-3',
          }], []];
        }
        throw new Error(`Unexpected master SQL: ${sql}`);
      },
    };

    const result = await migrateTenantDoctorAbsencesToCentral({
      tenantDb,
      masterDb,
      tenantId: 'tenant-1',
      doctorId: 'doc-3',
      employeeId: 'emp-3',
    });

    // 'new' is imported, 'dup' is a redundant leftover — both deleted locally.
    // 'conflict' stays because a different central absence holds that day.
    expect([...deleted].sort()).toEqual(['dup', 'new']);
    expect(result).toEqual({
      imported: 1,
      removedLocal: 2,
      skippedInvalidDate: [],
      localAbsences: 3,
      existingCentral: 1,
      centralTotal: 2,
      conflicts: 1,
      linkStatus: 'ok',
      linkRepaired: false,
    });
  });

  it('previews how many local absences would move to central storage', async () => {
    const tenantDb = createMigrationTenantDb();
    const masterDb = createMigrationMasterDb();

    const result = await previewTenantDoctorAbsenceMigration({
      tenantDb,
      masterDb,
      doctorId: 'doc-1',
    });

    expect(result).toEqual({
      imported: 1,
      removedLocal: 2,
      localAbsences: 2,
      existingCentral: 1,
      centralTotal: 5,
      conflicts: 0,
      skippedInvalidDate: [],
      linkStatus: 'ok',
    });
    expect(masterDb.calls.filter(({ sql }) => sql.startsWith('INSERT INTO CentralAbsenceEntry'))).toHaveLength(0);
  });

  it('migrates existing linked assignments across accessible tenants', async () => {
    const masterDb = createMigrationMasterDb();
    const withTenantDb = async (token, callback) => {
      if (token.id === 'tenant-2') {
        throw new Error('Tenant offline');
      }
      return await callback(createMigrationTenantDb(), token);
    };

    const result = await migrateLinkedAssignmentsToCentral({
      assignments: [
        {
          employee_id: 'emp-1',
          employee_name: 'Max Mustermann',
          tenant_id: 'tenant-1',
          tenant_name: 'Notaufnahme',
          tenant_doctor_id: 'doc-1',
        },
        {
          employee_id: 'emp-2',
          employee_name: 'Erika Muster',
          tenant_id: 'tenant-2',
          tenant_name: 'Station X',
          tenant_doctor_id: 'doc-2',
        },
      ],
      tokensById: new Map([
        ['tenant-1', { id: 'tenant-1' }],
        ['tenant-2', { id: 'tenant-2' }],
      ]),
      withTenantDb,
      masterDb,
    });

    expect(result.migratedAssignments).toBe(1);
    expect(result.failedAssignments).toBe(1);
    expect(result.importedAbsences).toBe(1);
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ tenant_id: 'tenant-1', status: 'success', imported: 1 }),
      expect.objectContaining({ tenant_id: 'tenant-2', status: 'error', error: 'Tenant offline' }),
    ]));
  });

  it('supports a dry-run across linked assignments without writing central rows', async () => {
    const masterDb = createMigrationMasterDb();
    const withTenantDb = async (_token, callback) => await callback(createMigrationTenantDb());

    const result = await migrateLinkedAssignmentsToCentral({
      assignments: [{
        employee_id: 'emp-1',
        employee_name: 'Max Mustermann',
        tenant_id: 'tenant-1',
        tenant_name: 'Notaufnahme',
        tenant_doctor_id: 'doc-1',
      }],
      tokensById: new Map([['tenant-1', { id: 'tenant-1' }]]),
      withTenantDb,
      masterDb,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.importedAbsences).toBe(1);
    expect(result.existingCentralAbsences).toBe(1);
    expect(result.results).toEqual([
      expect.objectContaining({
        tenant_id: 'tenant-1',
        status: 'success',
        imported: 1,
        localAbsences: 2,
        existingCentral: 1,
        dry_run: true,
      }),
    ]);
    expect(masterDb.calls.filter(({ sql }) => sql.startsWith('INSERT INTO CentralAbsenceEntry'))).toHaveLength(0);
  });
});