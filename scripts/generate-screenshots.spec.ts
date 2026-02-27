/**
 * Automated README screenshot generator.
 *
 * Produces the four images referenced by README.md:
 *   docs/images/screenshot-light.png   — Register view, light theme
 *   docs/images/screenshot-dark.png    — Register view, dark theme
 *   docs/images/map-view-light.png     — Map view, light theme
 *   docs/images/map-view-dark.png      — Map view, dark theme
 *
 * Run:  npm run screenshots
 */

import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clear all app state so each screenshot starts fresh. */
async function resetApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // Wait for the default seed register to confirm the app has loaded
  await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
}

/** Load an example project via Menu → Examples → select → confirm. */
async function loadExample(page: Page, exampleName: string) {
  await page.getByRole('button', { name: 'Application menu' }).click();
  await page.getByRole('menuitem', { name: 'Examples' }).click();

  // Click the example button matching the name
  await page.getByRole('button', { name: exampleName }).click();
  // Confirm the replacement
  await page.getByRole('button', { name: 'Load' }).click();
}

/** Set the app to light mode (default is dark). */
async function setLightMode(page: Page) {
  await page.getByRole('button', { name: 'Application menu' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Dark mode' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  // Close the menu and blur the button so it doesn't appear highlighted
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 0, y: 0 } });
}

/** Set the app to dark mode (ensure it's on). */
async function ensureDarkMode(page: Page) {
  const isDark = await page.locator('html').evaluate((el) =>
    el.classList.contains('dark'),
  );
  if (!isDark) {
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Dark mode' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
  }
}

function hexInput(page: Page) {
  return page.locator('label').filter({ hasText: 'HEX' }).locator('input');
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

test.describe('Generate README screenshots', () => {
  test('screenshot-light — Register view, light theme', async ({ page }) => {
    await resetApp(page);
    await loadExample(page, 'All Field Types');

    // Wait for the first register to load
    await expect(page.getByRole('heading', { name: 'STATUS_CTRL' })).toBeVisible();

    // Set an interesting value so the bit grid and fields show decoded data
    await hexInput(page).fill('A5B3');
    await hexInput(page).blur();

    await setLightMode(page);

    // Small pause to let transitions settle
    await page.waitForTimeout(300);

    await page.screenshot({ path: 'docs/images/screenshot-light.png' });
  });

  test('screenshot-dark — Register view, dark theme', async ({ page }) => {
    await resetApp(page);
    await loadExample(page, 'All Field Types');

    await expect(page.getByRole('heading', { name: 'STATUS_CTRL' })).toBeVisible();

    await hexInput(page).fill('A5B3');
    await hexInput(page).blur();

    await ensureDarkMode(page);

    await page.waitForTimeout(300);

    await page.screenshot({ path: 'docs/images/screenshot-dark.png' });
  });

  test('map-view-light — Map view, light theme', async ({ page }) => {
    await resetApp(page);
    await loadExample(page, 'ATmega328P Full Register Map');

    // Wait for a register from the ATmega328P set to confirm load
    await expect(page.getByRole('heading', { name: 'PINB' })).toBeVisible();

    // Switch to Map tab
    await page.getByRole('button', { name: 'Map' }).click();
    await expect(page.getByTestId('map-view')).toBeVisible();

    // Uncheck "Show gaps" for a denser, more visually interesting map
    await page.getByLabel('Show gaps').uncheck();

    await setLightMode(page);

    await page.waitForTimeout(300);

    await page.screenshot({ path: 'docs/images/map-view-light.png' });
  });

  test('map-view-dark — Map view, dark theme', async ({ page }) => {
    await resetApp(page);
    await loadExample(page, 'ATmega328P Full Register Map');

    await expect(page.getByRole('heading', { name: 'PINB' })).toBeVisible();

    await page.getByRole('button', { name: 'Map' }).click();
    await expect(page.getByTestId('map-view')).toBeVisible();

    await page.getByLabel('Show gaps').uncheck();

    await ensureDarkMode(page);

    await page.waitForTimeout(300);

    await page.screenshot({ path: 'docs/images/map-view-dark.png' });
  });
});
