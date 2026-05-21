import { expect, type Locator, type Page } from '@playwright/test';

import { expectNoDatabaseProblemToast } from '../support/uiAssertions';

type AdminUserFormData = {
  email?: string;
  fullName?: string;
  password?: string;
  role?: 'user' | 'admin';
  sendPasswordEmail?: boolean;
};

export class AdminPage {
  readonly pageRoot: Locator;
  readonly usersTab: Locator;
  readonly settingsTab: Locator;
  readonly userManagementRoot: Locator;
  readonly createUserButton: Locator;
  readonly createUserDialog: Locator;
  readonly createUserEmailInput: Locator;
  readonly createUserNameInput: Locator;
  readonly createUserPasswordInput: Locator;
  readonly createUserRoleTrigger: Locator;
  readonly createUserSendPasswordEmailCheckbox: Locator;
  readonly createUserSubmitButton: Locator;
  readonly settingsRoot: Locator;
  readonly wishDeadlineInput: Locator;

  constructor(private readonly page: Page) {
    this.pageRoot = page.getByTestId('admin-page');
    this.usersTab = page.getByTestId('admin-tab-users');
    this.settingsTab = page.getByTestId('admin-tab-settings');
    this.userManagementRoot = page.getByTestId('admin-user-management');
    this.createUserButton = page.getByTestId('admin-user-create-button');
    this.createUserDialog = page.getByTestId('admin-user-create-dialog');
    this.createUserEmailInput = page.getByTestId('admin-user-create-email');
    this.createUserNameInput = page.getByTestId('admin-user-create-name');
    this.createUserPasswordInput = page.getByTestId('admin-user-create-password');
    this.createUserRoleTrigger = page.getByTestId('admin-user-create-role');
    this.createUserSendPasswordEmailCheckbox = page.getByTestId('admin-user-create-send-password-email');
    this.createUserSubmitButton = page.getByTestId('admin-user-create-submit');
    this.settingsRoot = page.getByTestId('admin-settings-panel');
    this.wishDeadlineInput = page.getByTestId('admin-settings-wish-deadline-months');
  }

  async goto() {
    await this.page.goto('/admin');
    await this.expectLoaded();
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/admin(?:\?|$)/);
    await expect(this.pageRoot).toBeVisible();
    await expectNoDatabaseProblemToast(this.page);
  }

  userRow(userId: string) {
    return this.page.getByTestId(`admin-user-row-${userId}`);
  }

  userRoleTrigger(userId: string) {
    return this.page.getByTestId(`admin-user-role-${userId}`);
  }

  userDeleteButton(userId: string) {
    return this.page.getByTestId(`admin-user-delete-${userId}`);
  }

  async openUsersTab() {
    await this.usersTab.click();
    await expect(this.userManagementRoot).toBeVisible();
  }

  async openSettingsTab() {
    await this.settingsTab.click();
    await expect(this.settingsRoot).toBeVisible();
  }

  async openCreateUserDialog() {
    await this.createUserButton.click();
    await expect(this.createUserDialog).toBeVisible();
  }

  async fillCreateUserForm(data: AdminUserFormData) {
    if (data.email !== undefined) {
      await this.createUserEmailInput.fill(data.email);
    }

    if (data.fullName !== undefined) {
      await this.createUserNameInput.fill(data.fullName);
    }

    if (data.password !== undefined) {
      await this.createUserPasswordInput.fill(data.password);
    }

    if (data.role !== undefined) {
      const roleLabel = data.role === 'admin' ? 'Administrator' : 'Benutzer';
      await this.createUserRoleTrigger.click();
      await this.page.getByRole('option', { name: roleLabel, exact: true }).click();
    }

    if (data.sendPasswordEmail !== undefined) {
      const isChecked = (await this.createUserSendPasswordEmailCheckbox.getAttribute('data-state')) === 'checked';
      if (isChecked !== data.sendPasswordEmail) {
        await this.createUserSendPasswordEmailCheckbox.click();
      }
    }
  }

  async submitCreateUserForm() {
    await this.createUserSubmitButton.click();
    await expect(this.createUserDialog).toHaveCount(0);
  }

  async createUser(data: AdminUserFormData) {
    await this.openCreateUserDialog();
    await this.fillCreateUserForm(data);
    await this.submitCreateUserForm();
  }

  async changeUserRole(userId: string, role: 'user' | 'admin') {
    const roleLabel = role === 'admin' ? 'Admin' : 'Benutzer';
    await this.userRoleTrigger(userId).click();
    await this.page.getByRole('option', { name: roleLabel, exact: true }).click();
  }

  async deleteUser(userId: string) {
    this.page.once('dialog', (dialog) => dialog.accept());
    await this.userDeleteButton(userId).click();
    await expect(this.userRow(userId)).toHaveCount(0);
  }

  async setWishDeadlineMonths(value: string) {
    await this.wishDeadlineInput.fill(value);
  }
}
