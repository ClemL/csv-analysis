import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { readZipDirectory, readZipEntry } from '../lib/zip';
import { SCREENS, deviceOptions, overflow } from './screens';

const FIXTURES = path.join(__dirname, '../tests/fixtures/xlsx');
// What ClosedXML itself wrote for these sheets, with LF line endings.
const expected = (name: string) => readFileSync(path.join(FIXTURES, 'closedxml', name), 'utf8');

async function openWorkbook(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Split XLSX', exact: true }).click();
  await page.getByLabel('Workbook file').setInputFiles(path.join(FIXTURES, 'claims_export.xlsx'));
  await expect(page.locator('.xlsx-sheet')).toHaveCount(5);
}

const sheet = (page: Page, file: string) => page.locator('.xlsx-sheet', { has: page.getByRole('heading', { name: file, exact: true }) });

async function downloaded(page: Page, click: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  const file = await download.path();
  return { name: download.suggestedFilename(), bytes: new Uint8Array(readFileSync(file)) };
}

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    test.use(deviceOptions(screen));

    test('splits a workbook into one file per sheet, fitting the screen', async ({ page }) => {
      await openWorkbook(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);

      // The empty sheet is where the importer throws, said at the top and on the sheet.
      await expect(page.locator('.notice.bad').first()).toContainText('NullReferenceException');
      await expect(sheet(page, 'claims_export.Empty.csv')).toContainText('RangeUsed()');
      await expect(sheet(page, 'claims_export.Claims.csv')).toContainText('h:mm tt');

      const small = await page
        .locator('button, select, input[type=text], input[type=number], label.field')
        .evaluateAll((elements) =>
          elements
            .map((el) => ({ el: el.outerHTML.slice(0, 80), height: el.getBoundingClientRect().height }))
            .filter((target) => target.height > 0 && target.height < 32),
        );
      expect(small, 'targets under 32px').toEqual([]);
    });
  });
}

test.describe('Split XLSX', () => {
  test.use(deviceOptions(SCREENS[0]));

  test('downloads a sheet exactly as ClosedXML writes it', async ({ page }) => {
    await openWorkbook(page);
    await page.getByLabel('Line ending').selectOption({ label: 'LF (Linux host)' });
    const claims = sheet(page, 'claims_export.Claims.csv');
    const file = await downloaded(page, () => claims.getByRole('button', { name: 'Download', exact: true }).click());
    expect(file.name).toBe('claims_export.Claims.csv');
    expect(new TextDecoder().decode(file.bytes)).toBe(expected('claims_export.Claims.csv'));
  });

  test('skips rows, ends lines with CRLF by default, and zips every written file', async ({ page }) => {
    await openWorkbook(page);
    const report = sheet(page, 'claims_export.Report.csv');
    await report.getByLabel('Skip rows').fill('2');
    // A textarea reports its value with LF; the CRLF shows in the zipped file below.
    await expect(report.locator('textarea')).toHaveValue('ndc|fills\n00093714656|12\n00378385593|7\n');

    const zip = await downloaded(page, () => page.getByRole('button', { name: 'Download all (.zip)' }).click());
    expect(zip.name).toBe('claims_export-csv.zip');
    const entries = readZipDirectory(zip.bytes);
    expect([...entries.keys()]).toEqual([
      'claims_export.Claims.csv',
      'claims_export.Summary.csv',
      'claims_export.Hidden lookup.csv',
      'claims_export.Report.csv',
    ]);
    const summary = new TextDecoder().decode(await readZipEntry(zip.bytes, entries.get('claims_export.Summary.csv')!));
    expect(summary).toBe(expected('claims_export.Summary.csv').replace(/\n/g, '\r\n'));
  });

  test('opens a sheet in Analyze and keeps the workbook for the way back', async ({ page }) => {
    await openWorkbook(page);
    await sheet(page, 'claims_export.Summary.csv').getByRole('button', { name: 'Open in Analyze' }).click();
    await expect(page.locator('.wb-file')).toHaveText('claims_export.Summary.csv');
    await expect(page.locator('.wb-colbtn', { hasText: /^covered_entity$/ })).toBeVisible();

    await page.getByRole('button', { name: 'Split XLSX', exact: true }).click();
    await expect(page.locator('.xlsx-sheet')).toHaveCount(5);
  });

  test('says so when the file is not a workbook', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Split XLSX', exact: true }).click();
    await page.getByLabel('Workbook file').setInputFiles(path.join(__dirname, 'fixtures/claims.csv'));
    await expect(page.locator('.notice.bad')).toContainText('not an .xlsx workbook');
  });
});
