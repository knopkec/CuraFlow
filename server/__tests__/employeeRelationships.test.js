import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock express to return a minimal router
vi.mock('express', () => {
  const handlers = {};
  const router = {
    get: (path, handler) => { handlers[`GET ${path}`] = handler; return router; },
    post: (path, handler) => { handlers[`POST ${path}`] = handler; return router; },
    put: (path, handler) => { handlers[`PUT ${path}`] = handler; return router; },
    patch: (path, handler) => { handlers[`PATCH ${path}`] = handler; return router; },
    delete: (path, handler) => { handlers[`DELETE ${path}`] = handler; return router; },
    use: () => router,
    _handlers: handlers,
  };
  return {
    default: { Router: () => router },
    Router: () => router,
  };
});

const mockDb = { execute: vi.fn() };

vi.mock('../index.js', () => ({ db: mockDb }));

vi.mock('../routes/auth.js', () => ({
  authMiddleware: (req, res, next) => next(),
  adminMiddleware: (req, res, next) => next(),
}));

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, randomUUID: () => 'test-uuid-1234' };
});

vi.mock('../utils/crypto.js', () => ({ parseDbToken: vi.fn() }));
vi.mock('../utils/masterEmployees.js', () => ({ deleteEmployeeDependentRecords: vi.fn() }));
vi.mock('../utils/masterEmployeeWorkSettings.js', () => ({
  resolveEmployeeTargetWeeklyHours: vi.fn(),
  syncEmployeeWorkSettingsToTenantDoctors: vi.fn(),
}));
vi.mock('../utils/centralAbsences.js', () => ({
  migrateLinkedAssignmentsToCentral: vi.fn(),
  migrateTenantDoctorAbsencesToCentral: vi.fn(),
  seedTenantDoctorAbsencesFromCentral: vi.fn(),
}));
vi.mock('../utils/realtime.js', () => ({ broadcastPlanUpdate: vi.fn(), buildRealtimeScope: vi.fn() }));
vi.mock('../routes/holidays.js', () => ({ getPublicHolidayDatesForYear: vi.fn(() => []), clearHolidayCache: vi.fn() }));
vi.mock('date-fns', () => ({
  format: vi.fn(() => '2026-01'),
  startOfMonth: vi.fn(() => new Date('2026-01-01')),
  endOfMonth: vi.fn(() => new Date('2026-01-31')),
  getDaysInMonth: vi.fn(() => 31),
}));

const { default: router } = await import('../routes/master.js');

function mockReqRes({ params = {}, body = {}, user = { sub: 'admin-1', email: 'admin@test.de' } } = {}) {
  const req = { params, body, user };
  const res = {
    status: vi.fn(function (code) { this.statusCode = code; return this; }),
    json: vi.fn(function (data) { this.jsonData = data; return this; }),
  };
  return { req, res };
}

function getHandler(method, path) {
  return router._handlers[`${method} ${path}`];
}

describe('Employee Relationships API', () => {
  beforeEach(() => {
    mockDb.execute.mockReset();
  });

  describe('GET /api/master/employees/:id/relationships', () => {
    it('returns relationships with employee names', async () => {
      mockDb.execute.mockResolvedValueOnce([
        [{
          id: 'rel-1', employee_id: 'emp-1', related_employee_id: 'emp-2',
          relationship_type: 'lebensgemeinschaft', shift_conflict: 1,
          employee_last_name: 'Müller', employee_first_name: 'Anna',
          related_last_name: 'Schmidt', related_first_name: 'Max',
        }],
        [],
      ]);

      const handler = getHandler('GET', '/employees/:id/relationships');
      const { req, res } = mockReqRes({ params: { id: 'emp-1' } });

      await handler(req, res, vi.fn());

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining('FROM EmployeeRelationship'),
        ['emp-1', 'emp-1']
      );
      expect(res.json).toHaveBeenCalledWith({
        relationships: expect.arrayContaining([
          expect.objectContaining({ id: 'rel-1', relationship_type: 'lebensgemeinschaft' }),
        ]),
      });
    });

    it('returns empty array when no relationships exist', async () => {
      mockDb.execute.mockResolvedValueOnce([[], []]);

      const handler = getHandler('GET', '/employees/:id/relationships');
      const { req, res } = mockReqRes({ params: { id: 'emp-1' } });

      await handler(req, res, vi.fn());
      expect(res.json).toHaveBeenCalledWith({ relationships: [] });
    });
  });

  describe('POST /api/master/employees/:id/relationships', () => {
    it('creates a relationship and returns it with names', async () => {
      mockDb.execute.mockResolvedValueOnce([[{ id: 'emp-1' }, { id: 'emp-2' }], []]);
      mockDb.execute.mockResolvedValueOnce([[], []]);
      mockDb.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
      mockDb.execute.mockResolvedValueOnce([
        [{
          id: 'test-uuid-1234', employee_id: 'emp-1', related_employee_id: 'emp-2',
          relationship_type: 'lebensgemeinschaft', shift_conflict: 1,
          employee_last_name: 'Müller', employee_first_name: 'Anna',
          related_last_name: 'Schmidt', related_first_name: 'Max',
        }],
        [],
      ]);

      const handler = getHandler('POST', '/employees/:id/relationships');
      const { req, res } = mockReqRes({
        params: { id: 'emp-1' },
        body: { related_employee_id: 'emp-2', relationship_type: 'lebensgemeinschaft', shift_conflict: true },
      });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        relationship: expect.objectContaining({
          id: 'test-uuid-1234', employee_id: 'emp-1', related_employee_id: 'emp-2',
          relationship_type: 'lebensgemeinschaft', shift_conflict: 1,
        }),
      });
    });

    it('returns 400 when related_employee_id is missing', async () => {
      const handler = getHandler('POST', '/employees/:id/relationships');
      const { req, res } = mockReqRes({
        params: { id: 'emp-1' },
        body: { relationship_type: 'lebensgemeinschaft' },
      });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'related_employee_id ist erforderlich' });
    });

    it('returns 400 when trying to relate to self', async () => {
      const handler = getHandler('POST', '/employees/:id/relationships');
      const { req, res } = mockReqRes({
        params: { id: 'emp-1' },
        body: { related_employee_id: 'emp-1' },
      });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Ein Mitarbeiter kann keine Beziehung zu sich selbst haben' });
    });

    it('returns 404 when one employee does not exist', async () => {
      mockDb.execute.mockResolvedValueOnce([[{ id: 'emp-1' }], []]);

      const handler = getHandler('POST', '/employees/:id/relationships');
      const { req, res } = mockReqRes({
        params: { id: 'emp-1' },
        body: { related_employee_id: 'emp-99' },
      });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Einer oder beide Mitarbeiter wurden nicht gefunden' });
    });

    it('returns 409 when relationship already exists', async () => {
      mockDb.execute.mockResolvedValueOnce([[{ id: 'emp-1' }, { id: 'emp-2' }], []]);
      mockDb.execute.mockResolvedValueOnce([[{ id: 'existing-rel' }], []]);

      const handler = getHandler('POST', '/employees/:id/relationships');
      const { req, res } = mockReqRes({
        params: { id: 'emp-1' },
        body: { related_employee_id: 'emp-2' },
      });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: 'Diese Beziehung existiert bereits' });
    });

    it('defaults relationship_type to lebensgemeinschaft', async () => {
      mockDb.execute.mockResolvedValueOnce([[{ id: 'emp-1' }, { id: 'emp-2' }], []]);
      mockDb.execute.mockResolvedValueOnce([[], []]);
      mockDb.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
      mockDb.execute.mockResolvedValueOnce([
        [{ id: 'test-uuid-1234', employee_id: 'emp-1', related_employee_id: 'emp-2', relationship_type: 'lebensgemeinschaft', shift_conflict: 0, employee_last_name: 'A', employee_first_name: 'B', related_last_name: 'C', related_first_name: 'D' }],
        [],
      ]);

      const handler = getHandler('POST', '/employees/:id/relationships');
      const { req, res } = mockReqRes({
        params: { id: 'emp-1' },
        body: { related_employee_id: 'emp-2' },
      });

      await handler(req, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('DELETE /api/master/employees/:id/relationships/:relationshipId', () => {
    it('deletes a relationship', async () => {
      mockDb.execute.mockResolvedValueOnce([[{ id: 'rel-1' }], []]);
      mockDb.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

      const handler = getHandler('DELETE', '/employees/:id/relationships/:relationshipId');
      const { req, res } = mockReqRes({ params: { id: 'emp-1', relationshipId: 'rel-1' } });

      await handler(req, res, vi.fn());

      expect(mockDb.execute).toHaveBeenCalledWith('DELETE FROM EmployeeRelationship WHERE id = ?', ['rel-1']);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('returns 404 when relationship not found', async () => {
      mockDb.execute.mockResolvedValueOnce([[], []]);

      const handler = getHandler('DELETE', '/employees/:id/relationships/:relationshipId');
      const { req, res } = mockReqRes({ params: { id: 'emp-1', relationshipId: 'nonexistent' } });

      await handler(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Beziehung nicht gefunden' });
    });
  });
});
