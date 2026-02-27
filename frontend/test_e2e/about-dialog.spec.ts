import { test, expect, type Page } from '@playwright/test';

async function resetApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
}

test.describe('About Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('opens from menu and shows expected content', async ({ page }) => {
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('menuitem', { name: 'About' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('About Register Viewer')).toBeVisible();
    await expect(dialog.getByText('decoding and encoding hardware register values')).toBeVisible();
  });

  test('shows GitHub link', async ({ page }) => {
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('menuitem', { name: 'About' }).click();

    const link = page.getByRole('dialog').getByRole('link', { name: /github\.com/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://github.com/chrissbarr/RegisterViewer');
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('shows build info with git hash', async ({ page }) => {
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('menuitem', { name: 'About' }).click();

    // Git hash is a short hex string (7+ chars); build date is YYYY-MM-DD
    await expect(page.getByRole('dialog').getByText(/[0-9a-f]{7,}/)).toBeVisible();
    await expect(page.getByRole('dialog').getByText(/\d{4}-\d{2}-\d{2}/)).toBeVisible();
  });

  test('closes via X button', async ({ page }) => {
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('menuitem', { name: 'About' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('closes via Escape key', async ({ page }) => {
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('menuitem', { name: 'About' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('closes via backdrop click', async ({ page }) => {
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('menuitem', { name: 'About' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click the dialog element itself (the backdrop area) at its top-left corner
    const dialog = page.getByRole('dialog');
    const box = await dialog.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 2, box.y + 2);
    }
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});
