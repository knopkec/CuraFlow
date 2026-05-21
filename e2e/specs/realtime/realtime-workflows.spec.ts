import type { Browser, Page } from '@playwright/test';

import { baseURL, storageStatePaths } from '../../support/config';
import { dbDelete, dbFilter, getAuthHeaders, type DbAuthHeaders } from '../../support/api';
import { expect, test } from '../../fixtures/auth';
import { StaffPage } from '../../pages/StaffPage';

type DoctorRecord = {
  id: string;
  initials: string;
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

async function openAdminStaffContext(browser: Browser) {
  const context = await browser.newContext({
    baseURL,
    storageState: storageStatePaths.admin,
  });
  const page = await context.newPage();
  const staffPage = new StaffPage(page);

  await staffPage.goto();

  return { context, page, staffPage };
}

test.describe('realtime workflows', () => {
  test('a doctor created in one admin context appears in another context without a reload', async ({
    browser,
    browserName,
    request,
  }) => {
    test.skip(browserName !== 'chromium', 'This flow mutates shared seeded data across browser projects.');

    const observer = await openAdminStaffContext(browser);
    const actor = await openAdminStaffContext(browser);
    const actorErrors = capturePageErrors(actor.page);
    const observerErrors = capturePageErrors(observer.page);
    const uniqueSuffix = `RT${Date.now().toString().slice(-3)}`;
    const doctorName = `Realtime ${uniqueSuffix}`;
    const doctorEmail = `${uniqueSuffix.toLowerCase()}@test.local`;
    let authHeaders: DbAuthHeaders | null = null;
    let createdDoctorId: string | null = null;

    try {
      authHeaders = await getAuthHeaders(actor.page);

      await observer.page.waitForTimeout(500);

      await actor.staffPage.createDoctor({
        name: doctorName,
        initials: uniqueSuffix,
        role: 'Assistenzarzt',
        email: doctorEmail,
        googleEmail: doctorEmail,
        targetWeeklyHours: '32.5',
      });

      await expect
        .poll(async () => {
          const doctors = await dbFilter<DoctorRecord>(request, authHeaders!, 'Doctor', { initials: uniqueSuffix });
          return doctors[0]?.id ?? null;
        }, { timeout: 10_000 })
        .not.toBeNull();

      const createdDoctor = (await dbFilter<DoctorRecord>(request, authHeaders, 'Doctor', { initials: uniqueSuffix }))[0];
      expect(createdDoctor).toBeDefined();
      createdDoctorId = createdDoctor.id;

      await expect
        .poll(async () => observer.staffPage.doctorCard(createdDoctorId!).count(), { timeout: 10_000 })
        .toBe(1);

      await actor.staffPage.deleteDoctor(createdDoctorId);

      await expect
        .poll(async () => observer.staffPage.doctorCard(createdDoctorId!).count(), { timeout: 10_000 })
        .toBe(0);

      assertNoPageErrors(actorErrors);
      assertNoPageErrors(observerErrors);
    } finally {
      if (authHeaders && createdDoctorId) {
        const remainingDoctors = await dbFilter<DoctorRecord>(request, authHeaders, 'Doctor', { id: createdDoctorId });
        if (remainingDoctors.length > 0) {
          await dbDelete(request, authHeaders, 'Doctor', createdDoctorId);
        }
      }

      await actor.context.close();
      await observer.context.close();
    }
  });
});
