import type { APIRequestContext, Page } from '@playwright/test';

import { backendURL } from './config';

export type DbAuthHeaders = Record<string, string>;

type DbPayload = {
  action: 'list' | 'filter' | 'get' | 'create' | 'update' | 'delete' | 'bulkCreate';
  table: string;
  id?: string;
  data?: Record<string, unknown> | Array<Record<string, unknown>>;
  query?: Record<string, unknown>;
};

export async function getAuthHeaders(page: Page): Promise<DbAuthHeaders> {
  const authState = await page.evaluate(() => ({
    jwtToken: localStorage.getItem('radioplan_jwt_token'),
    dbToken: localStorage.getItem('db_credentials'),
    dbTokenEnabled: localStorage.getItem('db_token_enabled') === 'true',
  }));

  if (!authState.jwtToken) {
    throw new Error('Missing JWT token in storage state');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${authState.jwtToken}`,
  };

  if (authState.dbTokenEnabled && authState.dbToken) {
    headers['X-DB-Token'] = authState.dbToken;
  }

  return headers;
}

async function resolveAuthHeaders(pageOrHeaders: Page | DbAuthHeaders) {
  if (typeof (pageOrHeaders as Page).evaluate === 'function') {
    return getAuthHeaders(pageOrHeaders as Page);
  }

  return pageOrHeaders as DbAuthHeaders;
}

export async function dbRequest<T>(
  request: APIRequestContext,
  pageOrHeaders: Page | DbAuthHeaders,
  payload: DbPayload
): Promise<T> {
  const response = await request.post(`${backendURL}/api/db`, {
    headers: {
      'Content-Type': 'application/json',
      ...(await resolveAuthHeaders(pageOrHeaders)),
    },
    data: payload,
  });

  if (!response.ok()) {
    throw new Error(`DB request failed (${response.status()}): ${await response.text()}`);
  }

  return response.json();
}

export function dbList<T>(request: APIRequestContext, pageOrHeaders: Page | DbAuthHeaders, table: string) {
  return dbRequest<T[]>(request, pageOrHeaders, { action: 'list', table });
}

export function dbFilter<T>(
  request: APIRequestContext,
  pageOrHeaders: Page | DbAuthHeaders,
  table: string,
  query: Record<string, unknown>
) {
  return dbRequest<T[]>(request, pageOrHeaders, { action: 'filter', table, query });
}

export function dbGet<T>(request: APIRequestContext, pageOrHeaders: Page | DbAuthHeaders, table: string, id: string) {
  return dbRequest<T>(request, pageOrHeaders, { action: 'get', table, id });
}

export function dbUpdate<T>(
  request: APIRequestContext,
  pageOrHeaders: Page | DbAuthHeaders,
  table: string,
  id: string,
  data: Record<string, unknown>
) {
  return dbRequest<T>(request, pageOrHeaders, { action: 'update', table, id, data });
}

export function dbDelete<T>(request: APIRequestContext, pageOrHeaders: Page | DbAuthHeaders, table: string, id: string) {
  return dbRequest<T>(request, pageOrHeaders, { action: 'delete', table, id });
}
