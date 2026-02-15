import { test, expect, type Page } from '@playwright/test';

async function resetApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
}

test.describe('Register Editor', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('clicking Edit enters editor mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Register' })).toBeVisible();
  });

  test('editing register name and saving updates the heading', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit' }).click();

    const nameInput = page.locator('label').filter({ hasText: 'Name' }).locator('input');
    await nameInput.clear();
    await nameInput.fill('MY_CUSTOM_REG');

    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('heading', { name: 'MY_CUSTOM_REG' })).toBeVisible();
  });

  test('canceling editor discards changes', async ({ page }) => {
    await page.getByRole('button', { name: 'Edit' }).click();

    const nameInput = page.locator('label').filter({ hasText: 'Name' }).locator('input');
    await nameInput.clear();
    await nameInput.fill('DISCARDED_NAME');

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
  });

  test('adding a field in editor and saving', async ({ page }) => {
    // Add a new register with no fields
    await page.getByRole('button', { name: '+ Add Register' }).click();
    await expect(page.getByRole('heading', { name: 'REG_1' })).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: '+ Add Field' }).click();

    // The field form opens inline with FIELD_0 in the Name input
    await expect(page.locator('input[value="FIELD_0"]')).toBeVisible();

    // Close the field form, then save
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Save' }).click();

    // Back in viewer mode, the field should be visible in the table
    await expect(page.getByRole('cell', { name: 'FIELD_0' })).toBeVisible();
  });
});
