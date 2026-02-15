import { test, expect, type Page } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function resetApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
}

test.describe('Import / Export', () => {
  test.beforeEach(async ({ page }) => {
    await resetApp(page);
  });

  test('importing a JSON file loads the register', async ({ page }) => {
    // Open the application menu and click Import
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('menuitem', { name: 'Import' }).click();

    // Set the file on the hidden file input
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(resolve(__dirname, 'fixtures', 'sample-import.json'));

    // The imported register should appear
    await expect(page.getByRole('heading', { name: 'CTRL_REG' })).toBeVisible();
    await expect(page.getByText('16-bit register')).toBeVisible();

    // Field names should appear in the table
    await expect(page.getByRole('cell', { name: 'EN', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'MODE', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'COUNT', exact: true })).toBeVisible();
  });

  test('export produces a downloadable JSON file', async ({ page }) => {
    // Open the application menu
    await page.getByRole('button', { name: 'Application menu' }).click();

    // Intercept the download
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('register-definitions.json');

    // Verify the content
    const content = await (await download.createReadStream())
      .toArray()
      .then((chunks) => Buffer.concat(chunks).toString('utf-8'));
    const data = JSON.parse(content);
    expect(data.version).toBe(1);
    expect(data.registers).toHaveLength(1);
    expect(data.registers[0].name).toBe('STATUS_REG');
  });
});
