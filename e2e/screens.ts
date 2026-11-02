import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

/**
 * The owner uses this app on a OnePlus Open, folded and unfolded, and on a
 * Galaxy Tab S Ultra. No published source gives these screens in CSS pixels,
 * so the sizes are the panels' resolutions over a typical Android scale. The
 * changelog dialog (from the version line in the status bar) shows a device's
 * real figures under "This screen"; correct these if they differ.
 */
export const SCREENS = [
  { name: 'OnePlus Open, folded', width: 425, height: 946, scale: 2.625, layout: 'phone' },
  { name: 'OnePlus Open, unfolded', width: 864, height: 930, scale: 2.625, layout: 'one column' },
  { name: 'Galaxy Tab S Ultra, portrait', width: 924, height: 1480, scale: 2, layout: 'one column' },
  { name: 'Galaxy Tab S Ultra, landscape', width: 1480, height: 924, scale: 2, layout: 'three panes' },
] as const;

export type Screen = (typeof SCREENS)[number];

/** Options for test.use() that make the page behave like that screen. */
export const deviceOptions = (screen: { width: number; height: number; scale: number }) => ({
  viewport: { width: screen.width, height: screen.height },
  deviceScaleFactor: screen.scale,
  isMobile: true,
  hasTouch: true,
});

/** How far the page scrolls sideways; anything above zero is a bug. */
export const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Opens the sample claims file in Analyze and waits for its profile. */
export async function openSample(page: Page) {
  await page.goto('/');
  await page.locator('input[type=file]').first().setInputFiles(path.join(__dirname, 'fixtures/claims.csv'));
  await page.locator('.wb-columns').waitFor();
}

const NDC_RESPONSE = readFileSync(path.join(__dirname, '../tests/fixtures/ndc.json'), 'utf8');

/** Answers the Generate tab's openFDA request from the captured fixture, so tests need no network. */
export async function routeOpenFda(page: Page) {
  await page.route('https://api.fda.gov/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: NDC_RESPONSE }),
  );
}

/** Generate mode with a sample built, so its "Use in" menu is showing. */
export async function openGenerated(page: Page) {
  await routeOpenFda(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Generate sample' }).click();
  await page.getByRole('button', { name: 'Fetch from openFDA' }).click();
  await page.getByRole('button', { name: 'Use in' }).waitFor();
}
