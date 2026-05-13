import { expect, type Locator, type Page } from '@playwright/test';

import { getUserPassword, seededUsers } from '../support/config';

export class LoginPage {
  readonly form: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly autoTenantActivation: Locator;
  readonly appShell: Locator;

  constructor(private readonly page: Page) {
    this.form = page.getByTestId('auth-login-form');
    this.emailInput = page.getByTestId('auth-login-email');
    this.passwordInput = page.getByTestId('auth-login-password');
    this.submitButton = page.getByTestId('auth-login-submit');
    this.autoTenantActivation = page.getByTestId('tenant-selection-auto-activating');
    this.appShell = page.getByTestId('app-shell');
  }

  async goto() {
    await this.page.goto('/authlogin');
    await this.expectLoaded();
  }

  async expectLoaded() {
    await expect(this.form).toBeVisible();
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
    await expect(this.submitButton).toBeVisible();
  }

  async signIn(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();

    await this.autoTenantActivation.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => null);
    await expect(this.page).not.toHaveURL(/\/authlogin(?:\?|$)/, { timeout: 20_000 });
    await expect(this.appShell).toBeVisible({ timeout: 20_000 });
  }

  async signInAsAdmin() {
    await this.signIn(seededUsers.admin.email, getUserPassword('admin'));
  }
}
