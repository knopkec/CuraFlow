import type { Download, Page } from '@playwright/test';

import { storageStatePaths } from '../../support/config';
import { expect, test } from '../../fixtures/auth';

function capturePageErrors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const ignoredPatterns = [
    /Cookie “__cf_bm” has been rejected for invalid domain/i,
  ];

  page.on('pageerror', (error) => {
    const message = error.stack || error.message;
    if (!ignoredPatterns.some((pattern) => pattern.test(message))) {
      pageErrors.push(message);
    }
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (!ignoredPatterns.some((pattern) => pattern.test(text))) {
        consoleErrors.push(text);
      }
    }
  });

  return { consoleErrors, pageErrors };
}

function assertNoRuntimeErrors(errors: { consoleErrors: string[]; pageErrors: string[] }) {
  const combined = [...errors.pageErrors, ...errors.consoleErrors];
  if (combined.length > 0) {
    throw new Error(`Unexpected runtime errors:\n${combined.join('\n\n')}`);
  }
}

async function expectDownload(downloadPromise: Promise<Download>, expectedPattern: RegExp) {
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(expectedPattern);
  expect(await download.failure()).toBeNull();
  expect(await download.path()).toBeTruthy();
}

test.describe('statistics workflows', () => {
  test.use({ storageState: storageStatePaths.admin });

  test('an admin can render the charts and export CSV, Excel, and PDF reports', async ({
    page,
    statisticsPage,
  }) => {
    const runtimeErrors = capturePageErrors(page);

    await statisticsPage.goto();
    await statisticsPage.selectYear('2026');
    await statisticsPage.selectMonth('Ganzes Jahr');

    await expect(statisticsPage.monthlyChart).toBeVisible();
    await expect(statisticsPage.servicesChart).toBeVisible();
    await expect(statisticsPage.rotationsChart).toBeVisible();

    await statisticsPage.openDetailsTab();

    await expectDownload(
      Promise.all([
        page.waitForEvent('download'),
        statisticsPage.exportCsvButton.click(),
      ]).then(([download]) => download),
      /^statistik_2026_.*\.csv$/
    );

    await expectDownload(
      Promise.all([
        page.waitForEvent('download'),
        statisticsPage.exportExcelButton.click(),
      ]).then(([download]) => download),
      /^statistik_2026_.*\.xls$/
    );

    await expectDownload(
      Promise.all([
        page.waitForEvent('download'),
        statisticsPage.exportPdfButton.click(),
      ]).then(([download]) => download),
      /^statistik_2026_.*\.pdf$/
    );

    assertNoRuntimeErrors(runtimeErrors);
  });
});
