import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth';
import { dbDelete, dbFilter, dbGet, dbList, dbUpdate, getAuthHeaders, type DbAuthHeaders } from '../../support/api';
import { storageStatePaths } from '../../support/config';

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

test.describe('staff workflows', () => {
  test.use({ storageState: storageStatePaths.admin });

  test('admin can create, edit, and delete a doctor with a qualification', async ({
    page,
    request,
    staffPage,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'This flow mutates shared seeded staff ordering across browser projects.');

    const pageErrors = capturePageErrors(page);
    const uniqueSuffix = `PW${Date.now().toString().slice(-3)}`;
    const createdDoctorName = `Playwright ${uniqueSuffix}`;
    const updatedDoctorName = `${createdDoctorName} Updated`;
    const createdDoctorEmail = `${uniqueSuffix.toLowerCase()}@test.local`;
    let qualificationId: string | null = null;
    let authHeaders: DbAuthHeaders | null = null;

    let cleanupDoctorId: string | null = null;

    try {
      await staffPage.goto();
      authHeaders = await getAuthHeaders(page);
      const qualificationMatches = await dbFilter<{
        id: string;
        name: string;
      }>(request, authHeaders, 'Qualification', { name: 'Strahlenschutz' });
      qualificationId = qualificationMatches[0]?.id ?? null;
      if (!qualificationId) {
        throw new Error('Seeded Strahlenschutz qualification was not found');
      }
      await staffPage.openCreateForm();
      await staffPage.fillForm({
        name: createdDoctorName,
        initials: uniqueSuffix,
        role: 'Assistenzarzt',
        email: createdDoctorEmail,
        googleEmail: createdDoctorEmail,
        targetWeeklyHours: '32.5',
      });
      assertNoPageErrors(pageErrors);
      await staffPage.fillForm({
        qualificationIds: [qualificationId],
      });
      assertNoPageErrors(pageErrors);
      await staffPage.submitForm();
      assertNoPageErrors(pageErrors);

      const createdDoctorMatches = await dbFilter<{
        id: string;
        name: string;
        role: string;
        target_weekly_hours: number | string | null;
      }>(request, authHeaders, 'Doctor', { initials: uniqueSuffix });

      expect(createdDoctorMatches).toHaveLength(1);

      const createdDoctor = createdDoctorMatches[0];
      cleanupDoctorId = createdDoctor.id;

      await expect(staffPage.doctorCard(createdDoctor.id)).toContainText(createdDoctorName);
      await expect(staffPage.doctorQualificationBadge(createdDoctor.id, qualificationId)).toBeVisible();

      const createdAssignments = await dbFilter<{ id: string }>(request, authHeaders, 'DoctorQualification', {
        doctor_id: createdDoctor.id,
        qualification_id: qualificationId,
      });

      expect(createdAssignments).toHaveLength(1);

      await staffPage.editDoctor(createdDoctor.id, {
        name: updatedDoctorName,
        role: 'Oberarzt',
        targetWeeklyHours: '36',
      });
      assertNoPageErrors(pageErrors);

      await expect(staffPage.doctorCard(createdDoctor.id)).toContainText(updatedDoctorName);

      const updatedDoctor = await dbGet<{
        name: string;
        role: string;
        target_weekly_hours: number | string | null;
      }>(request, authHeaders, 'Doctor', createdDoctor.id);

      expect(updatedDoctor.name).toBe(updatedDoctorName);
      expect(updatedDoctor.role).toBe('Oberarzt');
      expect(Number(updatedDoctor.target_weekly_hours)).toBe(36);

      await staffPage.deleteDoctor(createdDoctor.id);

      await expect
        .poll(async () => {
          const remainingDoctors = await dbFilter<{ id: string }>(request, authHeaders, 'Doctor', { id: createdDoctor.id });
          return remainingDoctors.length;
        }, { timeout: 10_000 })
        .toBe(0);

      assertNoPageErrors(pageErrors);
    } finally {
      if (cleanupDoctorId && authHeaders) {
        const danglingQualifications = await dbFilter<{ id: string }>(request, authHeaders, 'DoctorQualification', {
          doctor_id: cleanupDoctorId,
        });

        for (const assignment of danglingQualifications) {
          await dbDelete(request, authHeaders, 'DoctorQualification', assignment.id);
        }

        const remainingDoctors = await dbFilter<{ id: string }>(request, authHeaders, 'Doctor', { id: cleanupDoctorId });
        if (remainingDoctors.length > 0) {
          await dbDelete(request, authHeaders, 'Doctor', cleanupDoctorId);
        }
      }
    }
  });

  test('admin can reorder the seeded staff list and persist the new order', async ({
    page,
    request,
    staffPage,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'This flow mutates shared seeded staff ordering across browser projects.');

    const pageErrors = capturePageErrors(page);
    let authHeaders: DbAuthHeaders | null = null;
    let originalDoctors: Array<{
      id: string;
      order: number | null;
    }> = [];

    try {
      await staffPage.goto();
      authHeaders = await getAuthHeaders(page);
      originalDoctors = await dbList<{
        id: string;
        order: number | null;
      }>(request, authHeaders, 'Doctor');

      const orderedDoctors = [...originalDoctors].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
      const firstDoctor = orderedDoctors[0];
      const secondDoctor = orderedDoctors[1];

      await staffPage.dragDoctorBefore(secondDoctor.id, firstDoctor.id);

      await expect
        .poll(async () => {
          const reorderedDoctor = await dbGet<{ order: number | null }>(request, authHeaders, 'Doctor', secondDoctor.id);
          return reorderedDoctor.order;
        }, { timeout: 10_000 })
        .toBe(firstDoctor.order ?? 0);

      assertNoPageErrors(pageErrors);
    } finally {
      if (authHeaders) {
        for (const doctor of originalDoctors) {
          await dbUpdate(request, authHeaders, 'Doctor', doctor.id, { order: doctor.order ?? 0 });
        }
      }
    }
  });
});
