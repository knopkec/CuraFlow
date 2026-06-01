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
        expect(params).toEqual([
          'doc-1',
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
    ['2026-02-11', [{ id: 'already-central' }]],
  ]);

  return {
    calls,
    async execute(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('CREATE TABLE IF NOT EXISTS CentralAbsenceEntry')) {
        return [[], []];
      }

      if (sql.startsWith('SELECT id FROM CentralAbsenceEntry WHERE employee_id = ? AND date = ?')) {
        return [existingDates.get(params[1]) ?? [], []];
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

    expect(result).toEqual({ imported: 1, removedLocal: 2 });
    expect(masterDb.calls.filter(({ sql }) => sql.startsWith('INSERT INTO CentralAbsenceEntry'))).toHaveLength(1);
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