import { test as base, expect } from '@playwright/test';

import { AdminPage } from '../pages/AdminPage';
import { AppShellPage } from '../pages/AppShellPage';
import { LoginPage } from '../pages/LoginPage';
import { SchedulePage } from '../pages/SchedulePage';
import { StaffPage } from '../pages/StaffPage';
import { StatisticsPage } from '../pages/StatisticsPage';
import { TrainingPage } from '../pages/TrainingPage';
import { VacationPage } from '../pages/VacationPage';
import { WishListPage } from '../pages/WishListPage';

type E2EFixtures = {
  appShell: AppShellPage;
  adminPage: AdminPage;
  loginPage: LoginPage;
  schedulePage: SchedulePage;
  staffPage: StaffPage;
  statisticsPage: StatisticsPage;
  trainingPage: TrainingPage;
  vacationPage: VacationPage;
  wishListPage: WishListPage;
};

const e2eTest = base.extend<E2EFixtures>({
  appShell: async ({ page }, use) => {
    await use(new AppShellPage(page));
  },
  adminPage: async ({ page }, use) => {
    await use(new AdminPage(page));
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  schedulePage: async ({ page }, use) => {
    await use(new SchedulePage(page));
  },
  staffPage: async ({ page }, use) => {
    await use(new StaffPage(page));
  },
  statisticsPage: async ({ page }, use) => {
    await use(new StatisticsPage(page));
  },
  trainingPage: async ({ page }, use) => {
    await use(new TrainingPage(page));
  },
  vacationPage: async ({ page }, use) => {
    await use(new VacationPage(page));
  },
  wishListPage: async ({ page }, use) => {
    await use(new WishListPage(page));
  },
});

export const test = e2eTest;
export { expect };
