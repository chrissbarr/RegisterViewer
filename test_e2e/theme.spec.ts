import { test, expect, type Page } from '@playwright/test';

async function resetApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
}

test.describe('Theme Toggle', () => {
  test('app starts in dark mode by default', async ({ page }) => {
    await resetApp(page);
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('toggling dark mode removes dark class from html', async ({ page }) => {
    await resetApp(page);

    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Dark mode' }).click();

    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('theme persists across page reload', async ({ page }) => {
    await resetApp(page);

    // Toggle to light mode
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Dark mode' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    // Reload without clearing localStorage
    await page.reload();
    await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});
