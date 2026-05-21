import { expect, type Locator, type Page } from '@playwright/test';

export class TrainingPage {
  readonly page: Page;
  readonly root: Locator;
  readonly yearCurrent: Locator;
  readonly yearNext: Locator;
  readonly yearPrev: Locator;
  readonly doctorSelectTrigger: Locator;
  readonly transferButton: Locator;
  readonly transferDialog: Locator;
  readonly transferPreviewButton: Locator;
  readonly transferConfirmButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('training-page');
    this.yearCurrent = page.getByTestId('training-year-current');
    this.yearNext = page.getByTestId('training-year-next');
    this.yearPrev = page.getByTestId('training-year-prev');
    this.doctorSelectTrigger = page.getByTestId('training-doctor-select-trigger');
    this.transferButton = page.getByTestId('training-transfer-button');
    this.transferDialog = page.getByTestId('training-transfer-dialog');
    this.transferPreviewButton = page.getByTestId('training-transfer-preview');
    this.transferConfirmButton = page.getByTestId('training-transfer-confirm');
  }

  async goto() {
    await this.page.goto('/training');
    await this.expectLoaded();
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/training(?:\?|$)/);
    await expect(this.root).toBeVisible();
  }

  dayCell(date: string) {
    return this.page.getByTestId(`training-day-${date}`);
  }

  modalityButton(type: string) {
    return this.page.getByTestId(`training-modality-${type}`);
  }

  async setDisplayedYear(targetYear: number) {
    for (let guard = 0; guard < 6; guard += 1) {
      const currentYearText = (await this.yearCurrent.textContent())?.trim() ?? '';
      const currentYear = Number(currentYearText.slice(0, 4));
      if (currentYear === targetYear) {
        return;
      }

      if (currentYear < targetYear) {
        await this.yearNext.click();
      } else {
        await this.yearPrev.click();
      }
    }

    throw new Error(`Unable to navigate training page to year ${targetYear}`);
  }

  async selectDoctor(doctorId: string) {
    await this.doctorSelectTrigger.click();
    await this.page.getByTestId(`training-doctor-option-${doctorId}`).click();
  }

  async selectModality(modality: 'sono-rotation' | 'mrt-rotation' | 'delete') {
    await this.modalityButton(modality).click();
  }

  async createRotationRange(startDate: string, endDate: string) {
    await this.dayCell(startDate).click();
    await this.dayCell(endDate).click();
  }

  async openTransferDialog() {
    await this.transferButton.click();
    await expect(this.transferDialog).toBeVisible();
  }

  async chooseTransferMode(mode: 'day' | 'week' | 'from-date') {
    const testId = mode === 'from-date' ? 'training-transfer-mode-from-date' : `training-transfer-mode-${mode}`;
    await this.page.getByTestId(testId).click();
  }

  async showTransferPreview() {
    await this.transferPreviewButton.click();
  }

  async confirmTransfer() {
    await this.transferConfirmButton.click();
    await expect(this.transferDialog).toHaveCount(0);
  }
}
