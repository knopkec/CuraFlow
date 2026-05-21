import { expect, errors, type Page } from '@playwright/test';

export async function expectNoDatabaseProblemToast(page: Page) {
  const databaseProblemToast = page.getByText('Datenbankproblem');

  try {
    await databaseProblemToast.waitFor({ state: 'visible', timeout: 1500 });
    await expect(databaseProblemToast).not.toBeVisible();
  } catch (error) {
    if (error instanceof errors.TimeoutError) {
      return;
    }

    throw error;
  }
}
