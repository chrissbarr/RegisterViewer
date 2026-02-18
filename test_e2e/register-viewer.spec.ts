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
    await hexInput(page).fill('000000FF');
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

test.describe('Register Viewer - Hex Overwrite Mode', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('hex input is always full-width zero-padded', async ({ page }) => {
    await expect(hexInput(page)).toHaveValue('DEADBEEF');
    // 8 hex digits for 32-bit register
    const len = await hexInput(page).evaluate((el: HTMLInputElement) => el.value.length);
    expect(len).toBe(8);
  });

  test('typing overwrites digit at cursor and advances cursor', async ({ page }) => {
    const input = hexInput(page);
    // Set to all zeros first
    await input.fill('00000000');
    await input.blur();
    await input.click();
    // Place cursor at position 2
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 2));
    await page.keyboard.press('A');
    await page.keyboard.press('B');
    await expect(input).toHaveValue('00AB0000');
    const cursor = await input.evaluate((el: HTMLInputElement) => el.selectionStart);
    expect(cursor).toBe(4);
  });

  test('backspace replaces digit with zero and moves cursor left', async ({ page }) => {
    const input = hexInput(page);
    await input.click();
    // Place cursor at position 4 (after DEAD)
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(4, 4));
    await page.keyboard.press('Backspace');
    await expect(input).toHaveValue('DEA0BEEF');
    const cursor = await input.evaluate((el: HTMLInputElement) => el.selectionStart);
    expect(cursor).toBe(3);
  });

  test('backspace at position 0 is a no-op', async ({ page }) => {
    const input = hexInput(page);
    await input.click();
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 0));
    await page.keyboard.press('Backspace');
    await expect(input).toHaveValue('DEADBEEF');
    const cursor = await input.evaluate((el: HTMLInputElement) => el.selectionStart);
    expect(cursor).toBe(0);
  });

  test('delete replaces digit with zero and cursor stays', async ({ page }) => {
    const input = hexInput(page);
    await input.click();
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(4, 4));
    await page.keyboard.press('Delete');
    await expect(input).toHaveValue('DEAD0EEF');
    const cursor = await input.evaluate((el: HTMLInputElement) => el.selectionStart);
    expect(cursor).toBe(4);
  });

  test('delete at last position is a no-op', async ({ page }) => {
    const input = hexInput(page);
    await input.click();
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(8, 8));
    await page.keyboard.press('Delete');
    await expect(input).toHaveValue('DEADBEEF');
  });

  test('select-all and type replaces with left-aligned value', async ({ page }) => {
    const input = hexInput(page);
    await input.click();
    // Select all text, then type a replacement — uses insertText to reliably
    // trigger onChange with the replaced content (bypasses keydown)
    await input.evaluate((el: HTMLInputElement) => el.select());
    await page.keyboard.insertText('A');
    await expect(input).toHaveValue('A0000000');
  });

  test('backspace with selection zeros the selected range', async ({ page }) => {
    const input = hexInput(page);
    await input.click();
    // Select positions 2-6 (ADBE)
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 6));
    await page.keyboard.press('Backspace');
    await expect(input).toHaveValue('DE0000EF');
    const cursor = await input.evaluate((el: HTMLInputElement) => el.selectionStart);
    expect(cursor).toBe(2);
  });

  test('pasting 0x-prefixed value strips prefix and left-aligns', async ({ page }) => {
    const input = hexInput(page);
    await input.click();
    // Select all then insert text with 0x prefix — uses insertText to simulate
    // paste through the onChange path (bypasses keydown, triggers input event)
    await input.evaluate((el: HTMLInputElement) => el.select());
    await page.keyboard.insertText('0xFF');
    await input.blur();
    await expect(input).toHaveValue('FF000000');
    await expect(decInput(page)).toHaveValue('4278190080');
  });
});

test.describe('Register Viewer - Binary Overwrite Mode', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
    // Set to a known value: 0x000000FF → bin 0000...11111111
    await hexInput(page).fill('000000FF');
    await hexInput(page).blur();
  });

  test('bin input is always full-width zero-padded with spaces', async ({ page }) => {
    await expect(binInput(page)).toHaveValue('0000 0000 0000 0000 0000 0000 1111 1111');
  });

  test('typing overwrites digit at cursor and advances cursor', async ({ page }) => {
    const input = binInput(page);
    // Set to all zeros
    await hexInput(page).fill('00000000');
    await hexInput(page).blur();
    await input.click();
    // Place cursor at digit index 2 → formatted pos 2 (in "0000 0000 ...")
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 2));
    await page.keyboard.press('1');
    await page.keyboard.press('1');
    // Digits 2 and 3 overwritten: "0011 0000 ..."
    await expect(input).toHaveValue('0011 0000 0000 0000 0000 0000 0000 0000');
    await expect(hexInput(page)).toHaveValue('30000000');
  });

  test('typing at end of field is blocked', async ({ page }) => {
    const input = binInput(page);
    await input.click();
    // Move cursor to end
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(el.value.length, el.value.length));
    await page.keyboard.press('1');
    // Value unchanged
    await expect(input).toHaveValue('0000 0000 0000 0000 0000 0000 1111 1111');
  });

  test('backspace replaces digit with zero and moves cursor left', async ({ page }) => {
    const input = binInput(page);
    await input.click();
    // "0000 0000 0000 0000 0000 0000 1111 1111"
    // Digit 25 (second '1') is at formatted position 31.
    // Backspace zeros digit 24 (first '1') → ...0000 0111 1111 = 0x0000007F
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(31, 31));
    await page.keyboard.press('Backspace');
    await expect(hexInput(page)).toHaveValue('0000007F');
    await expect(input).toHaveValue('0000 0000 0000 0000 0000 0000 0111 1111');
    // Cursor moved left to digit 24 — formatted pos 29 (just before the nibble-group space)
    const cursor = await input.evaluate((el: HTMLInputElement) => el.selectionStart);
    expect(cursor).toBe(29);
  });

  test('backspace at position 0 is a no-op', async ({ page }) => {
    const input = binInput(page);
    await input.click();
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 0));
    await page.keyboard.press('Backspace');
    await expect(input).toHaveValue('0000 0000 0000 0000 0000 0000 1111 1111');
    const cursor = await input.evaluate((el: HTMLInputElement) => el.selectionStart);
    expect(cursor).toBe(0);
  });

  test('delete replaces digit with zero and cursor stays', async ({ page }) => {
    const input = binInput(page);
    await input.click();
    // Place cursor at digit 24 (first '1') — formatted position 30
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(30, 30));
    await page.keyboard.press('Delete');
    await expect(hexInput(page)).toHaveValue('0000007F');
    await expect(input).toHaveValue('0000 0000 0000 0000 0000 0000 0111 1111');
    // Cursor stays at digit 24 — formatted pos 29 (just before the nibble-group space)
    const cursor = await input.evaluate((el: HTMLInputElement) => el.selectionStart);
    expect(cursor).toBe(29);
  });

  test('delete at last position is a no-op', async ({ page }) => {
    const input = binInput(page);
    await input.click();
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(el.value.length, el.value.length));
    await page.keyboard.press('Delete');
    await expect(input).toHaveValue('0000 0000 0000 0000 0000 0000 1111 1111');
  });

  test('backspace with selection zeros the selected range', async ({ page }) => {
    const input = binInput(page);
    await input.click();
    // Select digits 24-28 (the "1111 " region) — formatted positions 30..34
    // "0000 0000 0000 0000 0000 0000 1111 1111"
    //  pos:                          30   35
    // Digits 24-27 are the first four '1's. Select formatted range 30 to 35 (4 digits + 1 space)
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(30, 35));
    await page.keyboard.press('Backspace');
    // Digits 24-27 zeroed: ...0000 0000 1111 = 0x0000000F
    await expect(hexInput(page)).toHaveValue('0000000F');
    await expect(input).toHaveValue('0000 0000 0000 0000 0000 0000 0000 1111');
  });

  test('select-all and type replaces with left-aligned value', async ({ page }) => {
    const input = binInput(page);
    await input.click();
    await input.evaluate((el: HTMLInputElement) => el.select());
    await page.keyboard.insertText('1');
    await expect(input).toHaveValue('1000 0000 0000 0000 0000 0000 0000 0000');
    await expect(hexInput(page)).toHaveValue('80000000');
  });

  test('pasting 0b-prefixed value strips prefix and left-aligns', async ({ page }) => {
    const input = binInput(page);
    await input.click();
    await input.evaluate((el: HTMLInputElement) => el.select());
    await page.keyboard.insertText('0b1010');
    await input.blur();
    await expect(input).toHaveValue('1010 0000 0000 0000 0000 0000 0000 0000');
    await expect(hexInput(page)).toHaveValue('A0000000');
  });

  test('pasting value with spaces strips spaces correctly', async ({ page }) => {
    const input = binInput(page);
    await input.click();
    await input.evaluate((el: HTMLInputElement) => el.select());
    await page.keyboard.insertText('1111 0000');
    await input.blur();
    await expect(input).toHaveValue('1111 0000 0000 0000 0000 0000 0000 0000');
    await expect(hexInput(page)).toHaveValue('F0000000');
  });

  test('cursor advances past last digit in nibble group', async ({ page }) => {
    const input = binInput(page);
    await hexInput(page).fill('00000000');
    await hexInput(page).blur();
    await input.click();
    // Place cursor at digit 3 (just before a space in "0000 0000...")
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(3, 3));
    await page.keyboard.press('1');
    // After overwriting digit 3, cursor advances to digit 4 — formatted pos 4 (just before the space)
    const cursor = await input.evaluate((el: HTMLInputElement) => el.selectionStart);
    expect(cursor).toBe(4);
    await expect(input).toHaveValue('0001 0000 0000 0000 0000 0000 0000 0000');
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
