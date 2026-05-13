import { test as base, expect } from '@playwright/test';

import { AppShellPage } from '../pages/AppShellPage';
import { LoginPage } from '../pages/LoginPage';

type E2EFixtures = {
  appShell: AppShellPage;
  loginPage: LoginPage;
};

const e2eTest = base.extend<E2EFixtures>({
  appShell: async ({ page }, use) => {
    await use(new AppShellPage(page));
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
});

export const test = e2eTest;
export { expect };
