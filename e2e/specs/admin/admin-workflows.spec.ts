import { randomBytes } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';

import { backendURL, storageStatePaths } from '../../support/config';
import { dbDelete, dbFilter, dbUpdate, getAuthHeaders, type DbAuthHeaders } from '../../support/api';
import { expect, test } from '../../fixtures/auth';

type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: string;
};

type SystemSetting = {
  id: string;
  key: string;
  value: string | null;
};

function capturePageErrors(page: Page) {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.stack || error.message);
  });
  return pageErrors;
}

function assertNoPageErrors(pageErrors: string[]) {
  if (pageErrors.length > 0) {
    throw new Error(`Unexpected page errors:\n${pageErrors.join('\n\n')}`);
  }
}

async function listUsers(request: APIRequestContext, authHeaders: DbAuthHeaders) {
  const response = await request.get(`${backendURL}/api/auth/users`, {
    headers: authHeaders,
  });

  if (!response.ok()) {
    throw new Error(`Failed to list users (${response.status()}): ${await response.text()}`);
  }

  return response.json() as Promise<AuthUser[]>;
}

async function deactivateUser(request: APIRequestContext, authHeaders: DbAuthHeaders, userId: string) {
  const response = await request.delete(`${backendURL}/api/auth/users/${userId}`, {
    headers: authHeaders,
  });

  if (!response.ok()) {
    throw new Error(`Failed to deactivate user (${response.status()}): ${await response.text()}`);
  }
}

function generateUserPassword() {
  return `Pw!A1-${randomBytes(12).toString('base64url')}`;
}

test.describe('admin workflows', () => {
  test.use({ storageState: storageStatePaths.admin });

  test('an admin can create a user, change the role, and deactivate the account', async ({
    adminPage,
    browserName,
    page,
    request,
  }) => {
    test.skip(browserName !== 'chromium', 'This flow mutates shared seeded admin data across browser projects.');

    const pageErrors = capturePageErrors(page);
    const uniqueSuffix = Date.now().toString().slice(-6);
    const email = `playwright-admin-${uniqueSuffix}@test.local`;
    const fullName = `Playwright Admin ${uniqueSuffix}`;
    const password = generateUserPassword();
    let authHeaders: DbAuthHeaders | null = null;
    let createdUserId: string | null = null;

    try {
      await adminPage.goto();
      await adminPage.openUsersTab();
      authHeaders = await getAuthHeaders(page);

      await adminPage.createUser({
        email,
        fullName,
        password,
        role: 'user',
        sendPasswordEmail: false,
      });

      await expect
        .poll(async () => {
          const users = await listUsers(request, authHeaders!);
          return users.some((candidate) => candidate.email === email);
        }, { timeout: 10_000 })
        .toBe(true);

      const createdUser = (await listUsers(request, authHeaders)).find((candidate) => candidate.email === email);
      expect(createdUser).toBeDefined();
      createdUserId = createdUser!.id;

      await expect(adminPage.userRow(createdUserId)).toBeVisible();

      await adminPage.changeUserRole(createdUserId, 'admin');

      await expect
        .poll(async () => {
          const users = await listUsers(request, authHeaders!);
          return users.find((candidate) => candidate.id === createdUserId)?.role ?? null;
        }, { timeout: 10_000 })
        .toBe('admin');

      await adminPage.deleteUser(createdUserId);

      await expect
        .poll(async () => {
          const users = await listUsers(request, authHeaders!);
          return users.some((candidate) => candidate.id === createdUserId);
        }, { timeout: 10_000 })
        .toBe(false);

      assertNoPageErrors(pageErrors);
    } finally {
      if (authHeaders && createdUserId) {
        const users = await listUsers(request, authHeaders);
        if (users.some((candidate) => candidate.id === createdUserId)) {
          await deactivateUser(request, authHeaders, createdUserId);
        }
      }
    }
  });

  test('an admin setting persists after reload', async ({
    adminPage,
    page,
    request,
  }) => {
    const pageErrors = capturePageErrors(page);
    await adminPage.goto();
    await adminPage.openSettingsTab();

    const authHeaders = await getAuthHeaders(page);
    const originalSettings = await dbFilter<SystemSetting>(request, authHeaders, 'SystemSetting', {
      key: 'wish_deadline_months',
    });
    const originalSetting = originalSettings[0] ?? null;
    const originalValue = originalSetting?.value ?? '';
    const nextValue = originalValue === '4' ? '5' : '4';

    try {
      await adminPage.setWishDeadlineMonths(nextValue);

      await expect
        .poll(async () => {
          const updatedSettings = await dbFilter<SystemSetting>(request, authHeaders, 'SystemSetting', {
            key: 'wish_deadline_months',
          });
          return updatedSettings[0]?.value ?? null;
        }, { timeout: 10_000 })
        .toBe(nextValue);

      await page.reload();
      await adminPage.expectLoaded();
      await adminPage.openSettingsTab();
      await expect(adminPage.wishDeadlineInput).toHaveValue(nextValue);
      assertNoPageErrors(pageErrors);
    } finally {
      const currentSettings = await dbFilter<SystemSetting>(request, authHeaders, 'SystemSetting', {
        key: 'wish_deadline_months',
      });
      const currentSetting = currentSettings[0] ?? null;

      if (originalSetting && currentSetting) {
        await dbUpdate(request, authHeaders, 'SystemSetting', currentSetting.id, { value: originalValue });
      } else if (!originalSetting && currentSetting) {
        await dbDelete(request, authHeaders, 'SystemSetting', currentSetting.id);
      }
    }
  });
});
