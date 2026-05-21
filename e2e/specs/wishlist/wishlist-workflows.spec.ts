import { addMonths, format, parseISO, startOfMonth } from 'date-fns';
import type { BrowserContext, Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth';
import { WishListPage } from '../../pages/WishListPage';
import {
  dbDelete,
  dbFilter,
  dbUpdate,
  getAuthHeaders,
  type DbAuthHeaders,
} from '../../support/api';
import { seededSchedule, storageStatePaths } from '../../support/config';

type SystemSetting = {
  id: string;
  key: string;
  value: string;
};

type WishRequest = {
  id: string;
  doctor_id: string;
  date: string;
  position: string;
  status: string;
};

type ShiftEntry = {
  id: string;
  doctor_id: string;
  date: string;
  position: string;
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

async function deleteMatchingWishes(
  request: Parameters<typeof dbFilter>[0],
  authHeaders: DbAuthHeaders,
  doctorId: string,
  date: string,
  position: string
) {
  const wishes = await dbFilter<WishRequest>(request, authHeaders, 'WishRequest', {
    doctor_id: doctorId,
    date,
    position,
  });

  for (const wish of wishes) {
    await dbDelete(request, authHeaders, 'WishRequest', wish.id);
  }
}

async function deleteMatchingShifts(
  request: Parameters<typeof dbFilter>[0],
  authHeaders: DbAuthHeaders,
  doctorId: string,
  date: string,
  position: string
) {
  const shifts = await dbFilter<ShiftEntry>(request, authHeaders, 'ShiftEntry', {
    doctor_id: doctorId,
    date,
    position,
  });

  for (const shift of shifts) {
    await dbDelete(request, authHeaders, 'ShiftEntry', shift.id);
  }
}

test.describe('wishlist workflows', () => {
  test('a user can submit a wish and an admin can approve it', async ({ browser, request, browserName }) => {
    test.skip(browserName !== 'chromium', 'This flow mutates shared seeded wishes and settings across browser projects.');

    const doctorId = 'doctor-clara';
    const position = 'Dienst Vordergrund';
    const wishDate = startOfMonth(addMonths(parseISO(`${seededSchedule.targetMonth}-01`), 1));
    const wishDateString = format(wishDate, 'yyyy-MM-dd');

    let adminContext: BrowserContext | null = null;
    let userContext: BrowserContext | null = null;
    let adminHeaders: DbAuthHeaders | null = null;
    let originalDeadlineSetting: SystemSetting | null = null;
    let originalApprovalSetting: SystemSetting | null = null;
    let adminPageErrors: string[] = [];
    let userPageErrors: string[] = [];

    try {
      adminContext = await browser.newContext({ storageState: storageStatePaths.admin });
      const adminPage = await adminContext.newPage();
      adminPageErrors = capturePageErrors(adminPage);
      const adminWishListPage = new WishListPage(adminPage);
      await adminWishListPage.goto();
      adminHeaders = await getAuthHeaders(adminPage);

      [originalDeadlineSetting] = await dbFilter<SystemSetting>(request, adminHeaders, 'SystemSetting', {
        key: 'wish_deadline_months',
      });
      [originalApprovalSetting] = await dbFilter<SystemSetting>(request, adminHeaders, 'SystemSetting', {
        key: 'wish_approval_rules',
      });

      if (!originalDeadlineSetting || !originalApprovalSetting) {
        throw new Error('Seeded wish settings were not found');
      }

      const updatedApprovalRules = {
        ...JSON.parse(originalApprovalSetting.value || '{}'),
        service_requires_approval: true,
        auto_create_shift_on_approval: true,
      };

      await dbUpdate(request, adminHeaders, 'SystemSetting', originalDeadlineSetting.id, { value: '0' });
      await dbUpdate(request, adminHeaders, 'SystemSetting', originalApprovalSetting.id, {
        value: JSON.stringify(updatedApprovalRules),
      });

      await deleteMatchingWishes(request, adminHeaders, doctorId, wishDateString, position);
      await deleteMatchingShifts(request, adminHeaders, doctorId, wishDateString, position);

      userContext = await browser.newContext({ storageState: storageStatePaths.user });
      const userPage = await userContext.newPage();
      userPageErrors = capturePageErrors(userPage);
      const userWishListPage = new WishListPage(userPage);

      await userWishListPage.goto();
      await userWishListPage.setDisplayedYear(wishDate.getFullYear());
      await userWishListPage.openWishForDate(wishDateString);
      await userWishListPage.submitWish('Playwright approval workflow');

      await expect
        .poll(async () => await userWishListPage.dayCell(wishDateString).getAttribute('title'))
        .toContain('Ausstehend');

      await expect
        .poll(async () => {
          const wishes = await dbFilter<WishRequest>(request, adminHeaders!, 'WishRequest', {
            doctor_id: doctorId,
            date: wishDateString,
            position,
          });
          return wishes[0]?.status ?? null;
        })
        .toBe('pending');

      await adminWishListPage.setDisplayedYear(wishDate.getFullYear());
      await adminWishListPage.selectDoctor(doctorId);
      await adminWishListPage.openWishForDate(wishDateString);
      await adminWishListPage.approveWish();

      await expect
        .poll(async () => await adminWishListPage.dayCell(wishDateString).getAttribute('title'))
        .toContain('Genehmigt');

      await expect
        .poll(async () => {
          const wishes = await dbFilter<WishRequest>(request, adminHeaders!, 'WishRequest', {
            doctor_id: doctorId,
            date: wishDateString,
            position,
          });
          const shifts = await dbFilter<ShiftEntry>(request, adminHeaders!, 'ShiftEntry', {
            doctor_id: doctorId,
            date: wishDateString,
            position,
          });

          return {
            shiftCount: shifts.length,
            wishStatus: wishes[0]?.status ?? null,
          };
        })
        .toEqual({
          shiftCount: 1,
          wishStatus: 'approved',
        });

      assertNoPageErrors(userPageErrors);
      assertNoPageErrors(adminPageErrors);
    } finally {
      if (adminHeaders) {
        await deleteMatchingShifts(request, adminHeaders, doctorId, wishDateString, position);
        await deleteMatchingWishes(request, adminHeaders, doctorId, wishDateString, position);

        if (originalDeadlineSetting) {
          await dbUpdate(request, adminHeaders, 'SystemSetting', originalDeadlineSetting.id, {
            value: originalDeadlineSetting.value,
          });
        }

        if (originalApprovalSetting) {
          await dbUpdate(request, adminHeaders, 'SystemSetting', originalApprovalSetting.id, {
            value: originalApprovalSetting.value,
          });
        }
      }

      await userContext?.close();
      await adminContext?.close();
    }
  });
});
