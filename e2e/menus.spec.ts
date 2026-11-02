import { expect, test, type Page } from '@playwright/test';
import { SCREENS, deviceOptions, openGenerated } from './screens';

/** The phone in the report that started this: a menu ran 138px past its bottom. */
const SMALL_PHONE = { name: '412 × 760 phone', width: 412, height: 760, scale: 2.625 };

async function openMenu(page: Page) {
  await openGenerated(page);
  const button = page.getByRole('button', { name: 'Use in' });
  await button.click();
  const menu = page.getByRole('menu', { name: 'Use in' });
  await expect(menu).toBeVisible();
  return { button, menu };
}

async function rect(locator: import('@playwright/test').Locator) {
  return locator.evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
}

for (const screen of [...SCREENS, SMALL_PHONE]) {
  test.describe(screen.name, () => {
    test.use(deviceOptions(screen));

    test('the menu lands fully on screen, under its button', async ({ page }) => {
      const { button, menu } = await openMenu(page);
      const b = await rect(button);
      const m = await rect(menu);
      expect(m.top).toBeCloseTo(b.bottom + 6, 0);
      expect(m.left).toBeGreaterThanOrEqual(8);
      expect(m.right).toBeLessThanOrEqual(screen.width - 8);
      expect(m.bottom).toBeLessThanOrEqual(screen.height - 8);
      // No taller than the space below the button, and scrolls inside itself past that.
      const style = await menu.evaluate((el) => ({
        maxHeight: parseFloat(el.style.maxHeight),
        overflowY: getComputedStyle(el).overflowY,
      }));
      expect(style.maxHeight).toBeCloseTo(Math.max(160, screen.height - (b.bottom + 6) - 8), 0);
      expect(style.overflowY).toBe('auto');
      // Rendered into the body, so no clipping or transformed ancestor can cut it off.
      expect(await menu.evaluate((el) => el.parentElement === document.body)).toBe(true);
    });

    test('every action is reachable and the menu works from the keyboard', async ({ page }) => {
      const { button, menu } = await openMenu(page);
      const items = menu.getByRole('menuitem');
      await expect(items).toHaveCount(3);
      for (const item of await items.all()) await expect(item).toBeInViewport();
      await expect(items.first()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(button).toBeFocused();

      await button.click();
      await page.getByRole('menuitem', { name: 'Analyze' }).click();
      await expect(page.locator('.wb-columns')).toBeVisible();
    });

    test('a press outside closes the menu', async ({ page }) => {
      const { menu } = await openMenu(page);
      await page.locator('.wb-brand').click();
      await expect(menu).toHaveCount(0);
    });
  });
}

test.describe('OnePlus Open, menu while unfolding and scrolling', () => {
  test.use(deviceOptions(SCREENS[0]));

  test('the open menu follows its button through an unfold and a scroll', async ({ page }) => {
    const { button, menu } = await openMenu(page);
    await page.setViewportSize({ width: 864, height: 930 });
    await expect(menu).toBeVisible();
    const b = await rect(button);
    let m = await rect(menu);
    expect(m.top).toBeCloseTo(b.bottom + 6, 0);
    expect(m.right).toBeCloseTo(b.right, 0);
    expect(m.right).toBeLessThanOrEqual(864 - 8);

    await page.setViewportSize({ width: 425, height: 600 });
    await page.evaluate(() => window.scrollBy(0, 120));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(menu).toBeVisible();
    await expect
      .poll(async () => (await rect(menu)).top - (await rect(button)).bottom)
      .toBeCloseTo(6, 0);
    m = await rect(menu);
    expect(m.left).toBeGreaterThanOrEqual(8);
    expect(m.right).toBeLessThanOrEqual(425 - 8);
  });
});
