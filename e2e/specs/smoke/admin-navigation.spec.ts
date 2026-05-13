import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth';
import { storageStatePaths } from '../../support/config';

function capturePageErrors(page: Page) {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  return pageErrors;
}

test.describe('guest smoke', () => {
  test('renders the login form for signed-out users', async ({ loginPage }) => {
    await loginPage.goto();
  });

  test('allows an admin to sign in from the UI and reach the admin area', async ({ appShell, loginPage, page }) => {
    const pageErrors = capturePageErrors(page);

    await loginPage.goto();
    await loginPage.signInAsAdmin();
    await appShell.gotoAdmin();

    expect(pageErrors).toEqual([]);
  });
});

test.describe('authenticated smoke', () => {
  test.use({ storageState: storageStatePaths.admin });

  test('boots directly into the seeded schedule with saved admin state', async ({ appShell, page }) => {
    const pageErrors = capturePageErrors(page);

    await page.goto('/schedule');
    await appShell.expectOnSchedulePage();

    expect(pageErrors).toEqual([]);
  });
});
