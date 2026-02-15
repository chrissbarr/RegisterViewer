import { test, expect, type Page } from '@playwright/test';

async function resetApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
}

test.describe('Register Management', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('sidebar shows the seed register', async ({ page }) => {
    await expect(page.locator('aside').getByText('STATUS_REG')).toBeVisible();
  });

  test('adding a new register creates it and selects it', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add Register' }).click();

    await expect(page.getByRole('heading', { name: 'REG_1' })).toBeVisible();

    const hexInput = page.locator('label').filter({ hasText: 'HEX' }).locator('input');
    await expect(hexInput).toHaveValue('00000000');
  });

  test('selecting a register in sidebar switches the viewer', async ({ page }) => {
    // Add a second register
    await page.getByRole('button', { name: '+ Add Register' }).click();
    await expect(page.getByRole('heading', { name: 'REG_1' })).toBeVisible();

    // Click back on STATUS_REG in the sidebar
    await page.locator('aside').getByText('STATUS_REG').click();
    await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
  });

  test('deleting a register removes it from sidebar', async ({ page }) => {
    // Add a second register so there's a fallback
    await page.getByRole('button', { name: '+ Add Register' }).click();
    await expect(page.getByRole('heading', { name: 'REG_1' })).toBeVisible();

    // Switch back to STATUS_REG and delete it
    await page.locator('aside').getByText('STATUS_REG').click();
    await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();

    // Click the delete button (x) on STATUS_REG
    await page.locator('aside li').filter({ hasText: 'STATUS_REG' })
      .locator('button[title="Delete register"]').click();

    // Confirm the deletion (the li now shows "Delete?" instead of the register name)
    await page.locator('aside li').filter({ hasText: 'Delete?' })
      .getByRole('button', { name: 'Yes' }).click();

    // STATUS_REG should be gone, REG_1 should be active
    await expect(page.locator('aside').getByText('STATUS_REG')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'REG_1' })).toBeVisible();
  });
});
