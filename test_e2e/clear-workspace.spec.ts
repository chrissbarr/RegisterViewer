import { test, expect, type Page } from '@playwright/test';

async function resetApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
}

test.describe('Clear Workspace', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('clears all registers after confirmation', async ({ page }) => {
    // Verify we start with a register
    await expect(page.locator('aside').getByText('STATUS_REG')).toBeVisible();

    // Open menu and click "Clear workspace"
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('menuitem', { name: 'Clear workspace' }).click();

    // Confirmation dialog should appear
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('This will remove all registers')).toBeVisible();

    // Confirm the clear
    await page.getByRole('button', { name: 'Clear' }).click();

    // Dialog should close
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // All registers should be gone
    await expect(page.locator('aside').getByText('STATUS_REG')).not.toBeVisible();

    // The "Add Register" button should still be accessible
    await expect(page.getByRole('button', { name: '+ Add Register' })).toBeVisible();
  });

  test('cancelling the dialog does not clear registers', async ({ page }) => {
    // Open menu and click "Clear workspace"
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('menuitem', { name: 'Clear workspace' }).click();

    // Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Dialog should close, register should still be there
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('aside').getByText('STATUS_REG')).toBeVisible();
  });

  test('cleared workspace persists across reload', async ({ page }) => {
    // Clear the workspace
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('menuitem', { name: 'Clear workspace' }).click();
    await page.getByRole('button', { name: 'Clear' }).click();

    // Verify cleared
    await expect(page.locator('aside').getByText('STATUS_REG')).not.toBeVisible();

    // Reload the page
    await page.reload();

    // Should still be empty (not reloaded with seed data)
    await expect(page.locator('aside').getByText('STATUS_REG')).not.toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add Register' })).toBeVisible();
  });
});
