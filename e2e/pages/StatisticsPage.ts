import { expect, type Locator, type Page } from '@playwright/test';

import { expectNoDatabaseProblemToast } from '../support/uiAssertions';

export class StatisticsPage {
  readonly pageRoot: Locator;
  readonly yearTrigger: Locator;
  readonly monthTrigger: Locator;
  readonly exportCsvButton: Locator;
  readonly exportExcelButton: Locator;
  readonly exportPdfButton: Locator;
  readonly overviewTab: Locator;
  readonly detailsTab: Locator;
  readonly monthlyChart: Locator;
  readonly servicesChart: Locator;
  readonly rotationsChart: Locator;
  readonly detailsTable: Locator;

  constructor(private readonly page: Page) {
    this.pageRoot = page.getByTestId('statistics-page');
    this.yearTrigger = page.getByTestId('statistics-year-trigger');
    this.monthTrigger = page.getByTestId('statistics-month-trigger');
    this.exportCsvButton = page.getByTestId('statistics-export-csv');
    this.exportExcelButton = page.getByTestId('statistics-export-excel');
    this.exportPdfButton = page.getByTestId('statistics-export-pdf');
    this.overviewTab = page.getByTestId('statistics-tab-overview');
    this.detailsTab = page.getByTestId('statistics-tab-details');
    this.monthlyChart = page.getByTestId('statistics-monthly-chart');
    this.servicesChart = page.getByTestId('statistics-services-chart');
    this.rotationsChart = page.getByTestId('statistics-rotations-chart');
    this.detailsTable = page.getByTestId('statistics-details-table');
  }

  async goto() {
    await this.page.goto('/statistics');
    await this.expectLoaded();
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/statistics(?:\?|$)/);
    await expect(this.pageRoot).toBeVisible();
    await expectNoDatabaseProblemToast(this.page);
  }

  async selectYear(year: string) {
    await this.yearTrigger.click();
    await this.page.getByRole('option', { name: year, exact: true }).click();
  }

  async selectMonth(monthLabel: string) {
    await this.monthTrigger.click();
    await this.page.getByRole('option', { name: monthLabel, exact: true }).click();
  }

  async openDetailsTab() {
    await this.detailsTab.click();
    await expect(this.detailsTable).toBeVisible();
  }
}
