import { expect, type Locator, type Page } from '@playwright/test';

function getOptionTestId(prefix: string, value: string) {
  return `${prefix}${value}`;
}

export class WishListPage {
  readonly page: Page;
  readonly root: Locator;
  readonly yearCurrent: Locator;
  readonly yearNext: Locator;
  readonly yearPrev: Locator;
  readonly doctorSelectTrigger: Locator;
  readonly dialog: Locator;
  readonly reasonInput: Locator;
  readonly saveButton: Locator;
  readonly adminStatusTrigger: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('wishlist-page');
    this.yearCurrent = page.getByTestId('wishlist-year-current');
    this.yearNext = page.getByTestId('wishlist-year-next');
    this.yearPrev = page.getByTestId('wishlist-year-prev');
    this.doctorSelectTrigger = page.getByTestId('wishlist-doctor-select-trigger');
    this.dialog = page.getByTestId('wish-request-dialog');
    this.reasonInput = page.getByTestId('wish-reason-input');
    this.saveButton = page.getByTestId('wish-save-button');
    this.adminStatusTrigger = page.getByTestId('wish-admin-status-trigger');
  }

  async goto() {
    await this.page.goto('/wishlist');
    await this.expectLoaded();
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/wishlist(?:\?|$)/);
    await expect(this.root).toBeVisible();
  }

  dayCell(date: string) {
    return this.page.getByTestId(`wishlist-day-${date}`);
  }

  async setDisplayedYear(targetYear: number) {
    for (let guard = 0; guard < 6; guard += 1) {
      const currentYear = Number((await this.yearCurrent.textContent())?.trim());
      if (currentYear === targetYear) {
        return;
      }

      if (currentYear < targetYear) {
        await this.yearNext.click();
      } else {
        await this.yearPrev.click();
      }
    }

    throw new Error(`Unable to navigate wishlist to year ${targetYear}`);
  }

  async selectDoctor(doctorId: string) {
    await this.doctorSelectTrigger.click();
    await this.page.getByTestId(getOptionTestId('wishlist-doctor-option-', doctorId)).click();
  }

  async openWishForDate(date: string) {
    await this.dayCell(date).click();
    await expect(this.dialog).toBeVisible();
  }

  async submitWish(reason: string) {
    await this.reasonInput.fill(reason);
    await this.saveButton.click();
    await expect(this.dialog).toHaveCount(0);
  }

  async approveWish() {
    await this.adminStatusTrigger.click();
    await this.page.getByRole('option', { name: 'Genehmigt', exact: true }).click();
    await this.saveButton.click();
    await expect(this.dialog).toHaveCount(0);
  }
}
