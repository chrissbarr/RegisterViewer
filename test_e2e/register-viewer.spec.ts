import { test, expect, type Page } from '@playwright/test';

async function resetApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
}

function hexInput(page: Page) {
  return page.locator('label').filter({ hasText: 'HEX' }).locator('input');
}
function binInput(page: Page) {
  return page.locator('label').filter({ hasText: 'BIN' }).locator('input');
}
function decInput(page: Page) {
  return page.locator('label').filter({ hasText: 'DEC' }).locator('input');
}

test.describe('Register Viewer - Value Sync', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('page loads with seed register and default value', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
    await expect(page.getByText('32-bit register')).toBeVisible();
    await expect(hexInput(page)).toHaveValue('DEADBEEF');
  });

  test('changing hex input updates binary and decimal inputs', async ({ page }) => {
    await hexInput(page).fill('FF');
    await hexInput(page).blur();

    await expect(decInput(page)).toHaveValue('255');
    await expect(binInput(page)).toHaveValue('0000 0000 0000 0000 0000 0000 1111 1111');
  });

  test('changing decimal input updates hex input', async ({ page }) => {
    await decInput(page).fill('256');
    await decInput(page).blur();

    await expect(hexInput(page)).toHaveValue('00000100');
  });

  test('field table shows decoded field values for seed data', async ({ page }) => {
    const fieldNames = ['ENABLE', 'READY', 'MODE', 'ERROR_CODE', 'TEMPERATURE', 'GAIN'];
    for (const name of fieldNames) {
      await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
    }
  });
});

test.describe('Register Viewer - Bit Grid', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('clicking a bit cell toggles it and updates the value', async ({ page }) => {
    const initialHex = await hexInput(page).inputValue();

    // Click bit 0 (belongs to ENABLE field)
    await page.locator('[title="Bit 0 (ENABLE)"]').click();

    const newHex = await hexInput(page).inputValue();
    expect(newHex).not.toBe(initialHex);
  });
});

test.describe('Register Viewer - Field Editing', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('toggling a flag field updates the register value', async ({ page }) => {
    // With 0xDEADBEEF, bit 0 = 1, so ENABLE flag is "set"
    // Find the ENABLE row and click its flag button
    const enableRow = page.locator('tr').filter({ hasText: 'ENABLE' });
    await enableRow.getByRole('button', { name: 'set' }).click();

    // Bit 0 cleared: 0xDEADBEEF -> 0xDEADBEEE
    await expect(hexInput(page)).toHaveValue('DEADBEEE');
  });
});
