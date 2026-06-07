import type { APIRequestContext, Page } from '@playwright/test';

import { backendURL, seededSchedule, storageStatePaths } from '../../support/config';
import { expect, test } from '../../fixtures/auth';

async function getDbAuthHeaders(page: Page) {
  const authState = await page.evaluate(() => ({
    dbToken: localStorage.getItem('db_credentials'),
    dbTokenEnabled: localStorage.getItem('db_token_enabled'),
    jwtToken: localStorage.getItem('radioplan_jwt_token'),
  }));

  expect(authState.jwtToken).toBeTruthy();
  expect(authState.dbToken).toBeTruthy();
  expect(authState.dbTokenEnabled).toBe('true');

  return {
    Authorization: `Bearer ${authState.jwtToken}`,
    'Content-Type': 'application/json',
    'X-DB-Token': authState.dbToken ?? '',
  };
}

async function fetchSeededWeekShifts(page: Page, request: APIRequestContext) {
  const response = await request.post(`${backendURL}/api/db`, {
    headers: await getDbAuthHeaders(page),
    data: {
      action: 'filter',
      query: {
        date: {
          $gte: seededSchedule.rangeStart,
          $lte: seededSchedule.rangeEnd,
        },
      },
      table: 'ShiftEntry',
    },
  });

  expect(response.ok()).toBe(true);
  return response.json();
}

test.describe('schedule core workflows', () => {
  test.use({ storageState: storageStatePaths.admin });

  test('shows seeded assignments, exposes qualification warnings, and navigates schedule periods', async ({
    page,
    request,
    schedulePage,
  }) => {
    await schedulePage.goto(seededSchedule.focusDate, 'week');

    const seededShifts = await fetchSeededWeekShifts(page, request);
    const seededShiftIds = seededShifts.map((shift: { id: string }) => shift.id);

    expect(seededShiftIds).toEqual(
      expect.arrayContaining([
        seededSchedule.shiftIds.foreground,
        seededSchedule.shiftIds.background,
        seededSchedule.shiftIds.ct,
        seededSchedule.shiftIds.mrt,
      ])
    );

    await expect(schedulePage.shift(seededSchedule.shiftIds.foreground)).toBeVisible();
    await expect(schedulePage.shift(seededSchedule.shiftIds.background)).toBeVisible();
    await expect(schedulePage.shift(seededSchedule.shiftIds.ct)).toBeVisible();
    await expect(schedulePage.shift(seededSchedule.shiftIds.mrt)).toBeVisible();
    await expect(schedulePage.qualificationWarning(seededSchedule.shiftIds.ct)).toBeVisible();
    await expect(page.getByText('Datenbankproblem', { exact: true })).toHaveCount(0);

    await schedulePage.openMonthView();
    const mayLabel = await schedulePage.currentPeriodLabel.textContent();
    expect(mayLabel).toBeTruthy();

    await schedulePage.goToNextPeriod();
    await expect(schedulePage.currentPeriodLabel).not.toHaveText(mayLabel ?? '');

    await schedulePage.goToPreviousPeriod();
    await expect(schedulePage.currentPeriodLabel).toHaveText(mayLabel ?? '');
    await expect(schedulePage.shift(seededSchedule.shiftIds.foreground)).toBeVisible();
  });
});
