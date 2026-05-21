import { expect, type Page } from '@playwright/test';

export async function expectNoDatabaseProblemToast(page: Page) {
  await expect(page.getByText('Datenbankproblem')).toHaveCount(0);
}
