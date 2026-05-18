import { expect, type Locator, type Page } from '@playwright/test';

export class AppShellPage {
  readonly shell: Locator;
  readonly sidebar: Locator;
  readonly openSidebarButton: Locator;
  readonly adminLink: Locator;
  readonly staffLink: Locator;
  readonly schedulePage: Locator;
  readonly adminPage: Locator;
  readonly staffPage: Locator;

  constructor(private readonly page: Page) {
    this.shell = page.getByTestId('app-shell');
    this.sidebar = page.getByTestId('app-sidebar');
    this.openSidebarButton = page.getByTestId('sidebar-open-button');
    this.adminLink = page.getByTestId('nav-link-admin');
    this.staffLink = page.getByTestId('nav-link-staff');
    this.schedulePage = page.getByTestId('schedule-page');
    this.adminPage = page.getByTestId('admin-page');
    this.staffPage = page.getByTestId('staff-page');
  }

  async expectReady() {
    await expect(this.shell).toBeVisible();
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
  }

  async gotoStaff() {
    await this.ensureSidebarOpen();
    await this.staffLink.click();
    await expect(this.page).toHaveURL(/\/staff(?:\?|$)/);
    await expect(this.staffPage).toBeVisible();
  }
}
