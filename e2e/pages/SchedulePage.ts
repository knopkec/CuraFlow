import { expect, type Locator, type Page } from '@playwright/test';

export class SchedulePage {
  readonly page: Page;
  readonly root: Locator;
  readonly currentPeriodLabel: Locator;
  readonly previousPeriodButton: Locator;
  readonly nextPeriodButton: Locator;
  readonly monthViewButton: Locator;
  readonly weekViewButton: Locator;
  readonly dayViewButton: Locator;
  readonly undoButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('schedule-page');
    this.currentPeriodLabel = page.getByTestId('schedule-current-period');
    this.previousPeriodButton = page.getByTestId('schedule-nav-prev');
    this.nextPeriodButton = page.getByTestId('schedule-nav-next');
    this.monthViewButton = page.getByTestId('schedule-view-month');
    this.weekViewButton = page.getByTestId('schedule-view-week');
    this.dayViewButton = page.getByTestId('schedule-view-day');
    this.undoButton = page.getByTestId('schedule-undo');
  }

  async goto(date: string, view: 'week' | 'month' | 'day' = 'week') {
    await this.page.goto(`/schedule?view=${view}&date=${date}`);
    await this.expectLoaded();
  }

  async expectLoaded() {
    await expect(this.root).toBeVisible();
    await expect(this.currentPeriodLabel).toBeVisible();
  }

  shift(shiftId: string) {
    return this.page.getByTestId(`schedule-shift-${shiftId}`);
  }

  qualificationWarning(shiftId: string) {
    return this.page.getByTestId(`schedule-shift-qualification-warning-${shiftId}`);
  }

  availableDoctor(doctorId: string, date: string) {
    return this.page.getByTestId(`schedule-available-doctor-${doctorId}-${date}`);
  }

  sidebarDoctorHandle(doctorId: string) {
    return this.page.getByTestId(`schedule-sidebar-doctor-handle-${doctorId}`);
  }

  cell(date: string, rowName: string, timeslotId?: string | null) {
    const rawCellId = timeslotId ? `${date}__${rowName}__${timeslotId}` : `${date}__${rowName}`;
    return this.page.getByTestId(`schedule-cell-${encodeURIComponent(rawCellId)}`);
  }

  dayClearButton(date: string) {
    return this.page.getByTestId(`schedule-day-clear-${date}`);
  }

  rowHeader(rowName: string, timeslotId?: string | null) {
    const rawHeaderId = timeslotId ? `rowHeader__${rowName}__${timeslotId}` : `rowHeader__${rowName}`;
    return this.page.getByTestId(`schedule-row-header-${encodeURIComponent(rawHeaderId)}`);
  }

  rowClearButton(rowName: string, timeslotId?: string | null) {
    const rawHeaderId = timeslotId ? `rowHeader__${rowName}__${timeslotId}` : `rowHeader__${rowName}`;
    return this.page.getByTestId(`schedule-row-clear-${encodeURIComponent(rawHeaderId)}`);
  }

  async openMonthView() {
    await this.monthViewButton.click();
    await expect(this.monthViewButton).toHaveAttribute('data-state', 'active');
  }

  async openWeekView() {
    await this.weekViewButton.click();
    await expect(this.weekViewButton).toHaveAttribute('data-state', 'active');
  }

  async goToNextPeriod() {
    await this.nextPeriodButton.click();
  }

  async goToPreviousPeriod() {
    await this.previousPeriodButton.click();
  }

  async dragAvailableDoctorToCell(doctorId: string, date: string, rowName: string, timeslotId?: string | null) {
    await this.dragToTarget(this.availableDoctor(doctorId, date), this.cell(date, rowName, timeslotId));
  }

  async dragSidebarDoctorToCell(doctorId: string, date: string, rowName: string, timeslotId?: string | null) {
    await this.dragToTarget(this.sidebarDoctorHandle(doctorId), this.cell(date, rowName, timeslotId));
  }

  async dragSidebarDoctorToRowHeader(doctorId: string, rowName: string, timeslotId?: string | null) {
    await this.dragToTarget(this.sidebarDoctorHandle(doctorId), this.rowHeader(rowName, timeslotId));
  }

  async dragShiftToCell(shiftId: string, date: string, rowName: string, timeslotId?: string | null) {
    await this.dragToTarget(this.shift(shiftId), this.cell(date, rowName, timeslotId));
  }

  async clearDay(date: string) {
    const dialogPromise = this.page.waitForEvent('dialog');
    await this.dayClearButton(date).click({ force: true });
    const dialog = await dialogPromise;
    await dialog.accept();
  }

  async clearRow(rowName: string, timeslotId?: string | null) {
    const dialogPromise = this.page.waitForEvent('dialog');
    await this.rowClearButton(rowName, timeslotId).evaluate((element: HTMLButtonElement) => element.click());
    const dialog = await dialogPromise;
    await dialog.accept();
  }

  async undoLastChange() {
    await this.undoButton.click();
  }

  private async dragToTarget(source: Locator, target: Locator) {
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();

    if (!sourceBox || !targetBox) {
      throw new Error('Unable to calculate schedule drag target');
    }

    await this.page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 15 });
    await this.page.mouse.up();
  }
}
