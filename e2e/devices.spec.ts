import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { SCREENS, deviceOptions, openGenerated, openSample, overflow, routeOpenFda } from './screens';

const BCP_LOG = readFileSync(path.join(__dirname, '../tests/fixtures/bcp-out.log'), 'utf8');

/** Opens the changelog dialog from the status bar's newest entry. */
async function openChangelog(page: Page) {
  const trigger = page.locator('.changelog-trigger');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Changelog' })).toBeVisible();
}

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  expect(found, `${selector} is on the page`).not.toBeNull();
  return found!;
}

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    test.use(deviceOptions(screen));

    test('nothing scrolls sideways in any mode, with the longest value open', async ({ page }) => {
      await routeOpenFda(page);
      await openSample(page);
      // The note column holds a 219-character URL with no break in it.
      await page.locator('.wb-colbtn', { hasText: /^note$/ }).click();
      expect(await overflow(page), 'Analyze').toBeLessThanOrEqual(0);
      for (const tab of ['Preview', 'SQL script', 'EF model', 'First record', 'Load command']) {
        await page.getByRole('tab', { name: tab }).click();
        expect(await overflow(page), tab).toBeLessThanOrEqual(0);
      }
      await openChangelog(page);
      expect(await overflow(page), 'changelog').toBeLessThanOrEqual(0);
      await page.keyboard.press('Escape');

      for (const mode of ['Compare', 'Contract check']) {
        await page.getByRole('button', { name: mode, exact: true }).click();
        expect(await overflow(page), mode).toBeLessThanOrEqual(0);
      }
      await page.getByRole('button', { name: 'BCP log', exact: true }).click();
      await page.getByRole('textbox', { name: 'bcp log' }).fill(BCP_LOG);
      await expect(page.getByText('Rows copied').first()).toBeVisible();
      expect(await overflow(page), 'BCP log').toBeLessThanOrEqual(0);

      await page.getByRole('button', { name: 'Generate sample' }).click();
      await page.getByRole('button', { name: 'Fetch from openFDA' }).click();
      await page.getByRole('button', { name: 'Use in' }).click();
      expect(await overflow(page), 'Generate, menu open').toBeLessThanOrEqual(0);
    });

    test('the header and the jump box are in view, and the dialog and menu fit', async ({ page }) => {
      await openSample(page);
      await expect(page.locator('.wb-brand')).toBeInViewport();
      await expect(page.getByRole('combobox', { name: 'Jump to a column, tab or mode' })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Analyze', exact: true })).toBeInViewport();

      await openChangelog(page);
      const sheet = await box(page, '.sheet');
      expect(sheet.x).toBeGreaterThanOrEqual(0);
      expect(sheet.x + sheet.width).toBeLessThanOrEqual(screen.width);
      expect(sheet.y + sheet.height).toBeLessThanOrEqual(screen.height);

      await openGenerated(page);
      await page.getByRole('button', { name: 'Use in' }).click();
      const menu = await box(page, '.menu-list');
      expect(menu.x).toBeGreaterThanOrEqual(8);
      expect(menu.x + menu.width).toBeLessThanOrEqual(screen.width - 8);
      expect(menu.y + menu.height).toBeLessThanOrEqual(screen.height - 8);
    });

    test(`lays the workbench out as ${screen.layout}`, async ({ page }) => {
      await openSample(page);
      const rail = await box(page, '.wb-rail');
      const main = await box(page, '.wb-main');
      const table = await box(page, 'section[aria-label="Columns"]');
      const inspector = await box(page, '.wb-inspector');
      const output = await box(page, '.wb-output');
      if (screen.layout === 'three panes') {
        // Rail, main and inspector side by side.
        expect(rail.x + rail.width).toBeLessThanOrEqual(main.x + 1);
        expect(inspector.x).toBeGreaterThanOrEqual(table.x + table.width - 1);
        expect(inspector.y).toBeLessThan(output.y);
      } else {
        // The rail across the top, and the inspector between the table and the output tabs.
        expect(rail.y + rail.height).toBeLessThanOrEqual(main.y + 1);
        expect(inspector.y).toBeGreaterThanOrEqual(table.y + table.height - 1);
        expect(inspector.y + inspector.height).toBeLessThanOrEqual(output.y + 1);
        expect(inspector.width).toBeGreaterThan(screen.width - 40);
      }
    });

    test('touch targets are at least 32px tall', async ({ page }) => {
      const heights = () =>
        page
          .locator(
            'button, select, input[type=text], input[type=search], input[type=number], label.field',
          )
          .evaluateAll((elements) =>
            elements
              .map((el) => ({ el: el.outerHTML.slice(0, 80), height: el.getBoundingClientRect().height }))
              .filter((target) => target.height > 0),
          );
      await openSample(page);
      for (const tab of ['Load command', 'SQL script', 'EF model']) {
        await page.getByRole('tab', { name: tab }).click();
        const small = (await heights()).filter((target) => target.height < 32);
        expect(small, `${tab}: targets under 32px`).toEqual([]);
      }
      await openChangelog(page);
      expect((await heights()).filter((target) => target.height < 32)).toEqual([]);
    });

    test('the screen readout shows this screen and its layout', async ({ page }) => {
      await page.goto('/');
      await openChangelog(page);
      await expect(page.locator('.screen-size')).toHaveText(
        `${screen.width} × ${screen.height} CSS pixels at ${screen.scale}× · ${screen.layout}`,
      );
    });
  });
}

test.describe('OnePlus Open, unfolding', () => {
  test.use(deviceOptions(SCREENS[0]));

  test('unfolding keeps the selection, the collapsed input, the tab, typed text and the open dialog', async ({ page }) => {
    await openSample(page);
    const jump = page.getByRole('combobox', { name: 'Jump to a column, tab or mode' });
    await jump.fill('ndc');
    await jump.press('Enter');
    await expect(page.locator('.wb-ins-name')).toHaveText('ndc');

    await page.getByRole('tab', { name: 'Load command' }).click();
    await page.getByLabel('Blob path').fill('feeds/september.csv');
    await page.getByRole('tab', { name: 'Preview' }).click();
    const inputToggle = page.locator('.panel-toggle', { hasText: 'Input' });
    await inputToggle.click();
    await expect(inputToggle).toHaveAttribute('aria-expanded', 'false');
    await openChangelog(page);
    await expect(page.locator('.screen-size')).toContainText('425 × 946 CSS pixels at 2.625× · phone');

    await page.setViewportSize({ width: 864, height: 930 });
    await expect(page.locator('.screen-size')).toContainText('864 × 930 CSS pixels at 2.625× · one column');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');

    await expect(page.locator('.wb-ins-name')).toHaveText('ndc');
    await expect(inputToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Load command' }).click();
    await expect(page.getByLabel('Blob path')).toHaveValue('feeds/september.csv');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
