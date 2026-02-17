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

test.describe('Register Viewer - Copy Buttons', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await resetApp(page);
  });

  test('copy buttons are visible for all three inputs', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Copy hex value' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy decimal value' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy binary value' })).toBeVisible();
  });

  test('hex copy button copies value with 0x prefix', async ({ page }) => {
    await page.getByRole('button', { name: 'Copy hex value' }).click();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe('0xDEADBEEF');
  });

  test('decimal copy button copies raw decimal value', async ({ page }) => {
    await page.getByRole('button', { name: 'Copy decimal value' }).click();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe('3735928559');
  });

  test('binary copy button copies value with 0b prefix and no spaces', async ({ page }) => {
    await page.getByRole('button', { name: 'Copy binary value' }).click();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe('0b' + (0xDEADBEEF).toString(2).padStart(32, '0'));
  });
});

test.describe('Register Viewer - Cursor Preservation', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('typing invalid char in hex field keeps cursor in place', async ({ page }) => {
    const input = hexInput(page);
    // Seed value is DEADBEEF. Click to focus, then position cursor after "DEAD".
    await input.click();
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(4, 4));

    // Type an invalid character
    await page.keyboard.press('Q');

    // Value unchanged, cursor still at position 4
    await expect(input).toHaveValue('DEADBEEF');
    const cursor = await input.evaluate((el: HTMLInputElement) => el.selectionStart);
    expect(cursor).toBe(4);
  });

  test('typing invalid char in dec field keeps cursor in place', async ({ page }) => {
    const input = decInput(page);
    // Seed value is 3735928559. Position cursor after "3735".
    await input.click();
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(4, 4));

    await page.keyboard.press('x');

    await expect(input).toHaveValue('3735928559');
    const cursor = await input.evaluate((el: HTMLInputElement) => el.selectionStart);
    expect(cursor).toBe(4);
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
