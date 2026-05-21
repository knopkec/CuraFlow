import { expect, type Locator, type Page } from '@playwright/test';

import { expectNoDatabaseProblemToast } from '../support/uiAssertions';

export class AppShellPage {
  readonly shell: Locator;
  readonly sidebar: Locator;
  readonly openSidebarButton: Locator;
  readonly adminLink: Locator;
  readonly staffLink: Locator;
  readonly schedulePage: Locator;
  readonly adminPage: Locator;
  readonly staffPage: Locator;
  readonly readonlyBadge: Locator;
  readonly accountMenuTrigger: Locator;
  readonly logoutButton: Locator;
  readonly adminAccessDenied: Locator;

  constructor(private readonly page: Page) {
    this.shell = page.getByTestId('app-shell');
    this.sidebar = page.getByTestId('app-sidebar');
    this.openSidebarButton = page.getByTestId('sidebar-open-button');
    this.adminLink = page.getByTestId('nav-link-admin');
    this.staffLink = page.getByTestId('nav-link-staff');
    this.schedulePage = page.getByTestId('schedule-page');
    this.adminPage = page.getByTestId('admin-page');
    this.staffPage = page.getByTestId('staff-page');
    this.readonlyBadge = page.getByTestId('readonly-mode-badge');
    this.accountMenuTrigger = page.getByTestId('account-menu-trigger');
    this.logoutButton = page.getByTestId('account-menu-logout');
    this.adminAccessDenied = page.getByTestId('admin-access-denied');
  }

  async expectReady() {
    await expect(this.shell).toBeVisible();
    await expectNoDatabaseProblemToast(this.page);
  }

  async expectOnSchedulePage() {
    await this.expectReady();
    await expect(this.page).toHaveURL(/\/schedule(?:\?|$)/);
    await expect(this.schedulePage).toBeVisible();
  }

  async ensureSidebarOpen() {
    if (await this.openSidebarButton.isVisible().catch(() => false)) {
      await this.openSidebarButton.click();
    }

    await expect(this.sidebar).toBeVisible();
  }

  async gotoAdmin() {
    await this.ensureSidebarOpen();
    await this.adminLink.click();
    await expect(this.page).toHaveURL(/\/admin(?:\?|$)/);
    await expect(this.adminPage).toBeVisible();
    await expectNoDatabaseProblemToast(this.page);
  }

  async gotoStaff() {
    await this.ensureSidebarOpen();
    await this.staffLink.click();
    await expect(this.page).toHaveURL(/\/staff(?:\?|$)/);
    await expect(this.staffPage).toBeVisible();
    await expectNoDatabaseProblemToast(this.page);
  }

  async logout() {
    await this.accountMenuTrigger.click();
    await expect(this.logoutButton).toBeVisible();
    await Promise.all([
      this.page.waitForURL(/\/authlogin(?:\?|$)/),
      this.logoutButton.click({ force: true }),
    ]);
  }
}
