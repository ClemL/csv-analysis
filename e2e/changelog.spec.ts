import { expect, test, type Page } from '@playwright/test';
import { parseChangelog } from '../lib/changelog';

/** The entries as served, so these tests keep passing as lines are appended. */
async function entries(page: Page): Promise<string[]> {
  const response = await page.request.get('/updates.txt');
  expect(response.ok()).toBeTruthy();
  return parseChangelog(await response.text());
}

test('the footer shows build info and only the newest entry', async ({ page }) => {
  const lines = await entries(page);
  await page.goto('/');
  await expect(page.locator('.build-info > div').first()).toHaveText(
    /^CSV Inspector · v\d+\.\d+\.\d+ · built \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/,
  );
  await expect(page.locator('.changelog-trigger')).toHaveCount(1);
  await expect(page.locator('.changelog-trigger')).toHaveText(lines[lines.length - 1]);
});

test('the dialog lists every entry, newest first', async ({ page }) => {
  const lines = await entries(page);
  await page.goto('/');
  await page.locator('.changelog-trigger').click();
  await expect(page.locator('.sheet-title')).toHaveText('Changelog');
  await expect(page.locator('.changelog-list li')).toHaveText([...lines].reverse());
});

test('only a backdrop click closes the dialog', async ({ page }) => {
  await page.goto('/');
  await page.locator('.changelog-trigger').click();
  await expect(page.locator('.changelog-list')).toBeVisible();

  // A click inside the panel must not bubble up into a dismissal.
  await page.locator('.changelog-list li').first().click();
  await page.locator('.sheet').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.changelog-list')).toBeVisible();

  await page.locator('.scrim').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.changelog-list')).toHaveCount(0);
});

test('the changelog opens and closes from the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.locator('.changelog-trigger').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.changelog-list')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.changelog-list')).toHaveCount(0);
  await expect(page.locator('.changelog-trigger')).toBeFocused();
});

test('a missing or empty changelog degrades quietly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.route('**/updates.txt', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await expect(page.locator('.build-info > div').first()).toContainText('CSV Inspector');
  await expect(page.locator('.changelog-trigger')).toHaveCount(0);

  await page.unroute('**/updates.txt');
  await page.route('**/updates.txt', (route) => route.fulfill({ status: 200, body: '\n\n   \n' }));
  await page.goto('/');
  await expect(page.locator('.build-info > div').first()).toContainText('CSV Inspector');
  await expect(page.locator('.changelog-trigger')).toHaveCount(0);

  expect(errors).toEqual([]);
});
