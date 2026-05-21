import { expect, type Locator, type Page } from '@playwright/test';

import { expectNoDatabaseProblemToast } from '../support/uiAssertions';

export class VacationPage {
  readonly page: Page;
  readonly root: Locator;
  readonly yearCurrent: Locator;
  readonly yearNext: Locator;
  readonly yearPrev: Locator;
  readonly doctorSelectTrigger: Locator;
  readonly conflictDialog: Locator;
  readonly conflictConfirmButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('vacation-page');
    this.yearCurrent = page.getByTestId('vacation-year-current');
    this.yearNext = page.getByTestId('vacation-year-next');
    this.yearPrev = page.getByTestId('vacation-year-prev');
    this.doctorSelectTrigger = page.getByTestId('vacation-doctor-select-trigger');
    this.conflictDialog = page.getByTestId('vacation-conflict-dialog');
    this.conflictConfirmButton = page.getByTestId('vacation-conflict-confirm');
  }

  async goto() {
    await this.page.goto('/vacation');
    await this.expectLoaded();
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/vacation(?:\?|$)/);
    await expect(this.root).toBeVisible();
    await expectNoDatabaseProblemToast(this.page);
  }

  dayCell(date: string) {
    return this.page.getByTestId(`vacation-day-${date}`);
  }

  absenceTypeButton(type: string) {
    return this.page.getByTestId(`vacation-type-${type}`);
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

    throw new Error(`Unable to navigate vacation page to year ${targetYear}`);
  }

  async selectDoctor(doctorId: string) {
    await this.doctorSelectTrigger.click();
    await this.page.getByTestId(`vacation-doctor-option-${doctorId}`).click();
  }

  async selectAbsenceType(type: 'urlaub' | 'frei' | 'krank' | 'dienstreise' | 'nicht-verfugbar' | 'delete') {
    await this.absenceTypeButton(type).click();
  }

  async assignAbsenceOnDate(date: string) {
    await this.dayCell(date).click();
  }

  async confirmConflict() {
    await expect(this.conflictDialog).toBeVisible();
    await this.conflictConfirmButton.click();
    await expect(this.conflictDialog).toHaveCount(0);
  }
}
