import { test as base, expect } from '@playwright/test';

import { AppShellPage } from '../pages/AppShellPage';
import { LoginPage } from '../pages/LoginPage';
import { StaffPage } from '../pages/StaffPage';

type E2EFixtures = {
  appShell: AppShellPage;
  loginPage: LoginPage;
  staffPage: StaffPage;
};

const e2eTest = base.extend<E2EFixtures>({
  appShell: async ({ page }, use) => {
    await use(new AppShellPage(page));
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  staffPage: async ({ page }, use) => {
    await use(new StaffPage(page));
  },
});

export const test = e2eTest;
export { expect };
