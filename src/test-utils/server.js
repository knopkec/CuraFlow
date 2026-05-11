import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeEntities(entities = {}) {
  return Object.fromEntries(
    Object.entries(entities).map(([entityName, records]) => [entityName, ensureArray(records).map(clone)])
  );
}

function createEntityStore(initialEntities = {}) {
  const entities = normalizeEntities(initialEntities);

  const ensureEntity = (entityName) => {
    if (!entities[entityName]) {
      entities[entityName] = [];
    }

    return entities[entityName];
  };

  const getId = (record) => record?.id ?? record?._id;

  return {
    all(entityName) {
      return clone(ensureEntity(entityName));
    },
    get(entityName, id) {
      return clone(ensureEntity(entityName).find((record) => getId(record) === id) ?? null);
    },
    list(entityName) {
      return clone(ensureEntity(entityName));
    },
    filter(entityName, query = {}) {
      const records = ensureEntity(entityName);
      const filtered = records.filter((record) =>
        Object.entries(query).every(([key, expected]) => {
          const actual = record?.[key];

          if (Array.isArray(expected)) {
            return expected.includes(actual);
          }

          if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
            if (Array.isArray(expected.$in)) {
              return expected.$in.includes(actual);
            }

            if (expected.$ne !== undefined) {
              return actual !== expected.$ne;
            }
          }

          return actual === expected;
        })
      );

      return clone(filtered);
    },
    create(entityName, data = {}) {
      const records = ensureEntity(entityName);
      const nextRecord = {
        id: data.id ?? `${entityName.toLowerCase()}-${records.length + 1}`,
        ...clone(data),
      };

      records.push(nextRecord);
      return clone(nextRecord);
    },
    update(entityName, id, data = {}) {
      const records = ensureEntity(entityName);
      const index = records.findIndex((record) => getId(record) === id);

      if (index === -1) {
        return null;
      }

      records[index] = {
        ...records[index],
        ...clone(data),
      };

      return clone(records[index]);
    },
    delete(entityName, id) {
      const records = ensureEntity(entityName);
      const index = records.findIndex((record) => getId(record) === id);

      if (index === -1) {
        return false;
      }

      records.splice(index, 1);
      return true;
    },
    bulkCreate(entityName, data = []) {
      return ensureArray(data).map((record) => this.create(entityName, record));
    },
  };
}

function errorResponse(status, error) {
  return HttpResponse.json({ error }, { status });
}

export const server = setupServer();

export function createDbHandlers({ entities = {}, onRequest } = {}) {
  const store = createEntityStore(entities);

  return [
    http.post('*/api/db', async ({ request }) => {
      const payload = await request.json();
      const { action, table, id, data, query } = payload;

      onRequest?.(payload, store);

      switch (action) {
        case 'list':
          return HttpResponse.json(store.list(table));
        case 'filter':
          return HttpResponse.json(store.filter(table, query));
        case 'get': {
          const record = store.get(table, id);
          return record ? HttpResponse.json(record) : errorResponse(404, `${table} ${id} not found`);
        }
        case 'create':
          return HttpResponse.json(store.create(table, data));
        case 'update': {
          const record = store.update(table, id, data);
          return record ? HttpResponse.json(record) : errorResponse(404, `${table} ${id} not found`);
        }
        case 'delete': {
          const deleted = store.delete(table, id);
          return deleted
            ? HttpResponse.json({ success: true, id })
            : errorResponse(404, `${table} ${id} not found`);
        }
        case 'bulkCreate':
          return HttpResponse.json(store.bulkCreate(table, data));
        default:
          return errorResponse(400, `Unsupported db action: ${action}`);
      }
    }),
  ];
}

export function createAuthHandlers({
  user = null,
  loginResponse = null,
  tenants = [],
  hasFullAccess = false,
} = {}) {
  const clonedUser = user ? clone(user) : null;

  return [
    http.get('*/api/auth/me', () => {
      if (!clonedUser) {
        return errorResponse(401, 'Unauthorized');
      }

      return HttpResponse.json(clone(clonedUser));
    }),
    http.post('*/api/auth/login', async ({ request }) => {
      const credentials = await request.json();

      if (typeof loginResponse === 'function') {
        return HttpResponse.json(await loginResponse(credentials));
      }

      if (loginResponse) {
        return HttpResponse.json(clone(loginResponse));
      }

      if (!clonedUser) {
        return errorResponse(401, 'Invalid credentials');
      }

      return HttpResponse.json({
        token: 'test-jwt-token',
        user: clone(clonedUser),
        must_change_password: clonedUser.must_change_password === true,
      });
    }),
    http.get('*/api/auth/my-tenants', () =>
      HttpResponse.json({
        tenants: clone(tenants),
        hasFullAccess,
      })
    ),
    http.post('*/api/auth/presence', () => HttpResponse.json({ success: true })),
    http.post('*/api/auth/activate-tenant/:tokenId', ({ params }) =>
      HttpResponse.json({
        success: true,
        tokenId: params.tokenId,
      })
    ),
  ];
}

export function createRouteHandler(method, path, resolver) {
  return http[method.toLowerCase()](path, resolver);
}
