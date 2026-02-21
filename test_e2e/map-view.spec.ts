import { test, expect, type Page } from '@playwright/test';

// --- Test state fixtures -------------------------------------------------------

/** Three 8-bit registers at contiguous offsets with fields on the first one. */
const STATE_WITH_OFFSETS = {
  registers: [
    {
      id: 'reg-a', name: 'REG_A', width: 8, offset: 0,
      fields: [
        { id: 'f1', name: 'EN', msb: 0, lsb: 0, type: 'flag' },
        { id: 'f2', name: 'MODE', msb: 3, lsb: 1, type: 'integer', signedness: 'unsigned' },
        { id: 'f3', name: 'STATUS', msb: 7, lsb: 4, type: 'integer', signedness: 'unsigned' },
      ],
    },
    { id: 'reg-b', name: 'REG_B', width: 8, offset: 2, fields: [] },
    { id: 'reg-c', name: 'REG_C', width: 8, offset: 4, fields: [] },
  ],
  activeRegisterId: 'reg-a',
  registerValues: { 'reg-a': '0x00', 'reg-b': '0x00', 'reg-c': '0x00' },
  theme: 'dark',
  sidebarWidth: 224,
  sidebarCollapsed: false,
  mapTableWidth: 32,
  mapShowGaps: false,
  mapSortDescending: false,
  addressUnitBits: 8,
};

/** Registers with NO offsets — map tab should not appear. */
const STATE_NO_OFFSETS = {
  registers: [
    { id: 'reg-x', name: 'REG_X', width: 8, fields: [] },
    { id: 'reg-y', name: 'REG_Y', width: 16, fields: [] },
  ],
  activeRegisterId: 'reg-x',
  registerValues: { 'reg-x': '0x00', 'reg-y': '0x0000' },
  theme: 'dark',
  sidebarWidth: 224,
  sidebarCollapsed: false,
  mapTableWidth: 32,
  mapShowGaps: false,
  mapSortDescending: false,
  addressUnitBits: 8,
};

/** A 16-bit register at offset 0 — used for width selector tests. */
const STATE_WIDE_REGISTER = {
  registers: [
    {
      id: 'reg-w', name: 'WIDE_REG', width: 16, offset: 0,
      fields: [
        { id: 'fw1', name: 'LOW', msb: 7, lsb: 0, type: 'integer', signedness: 'unsigned' },
        { id: 'fw2', name: 'HIGH', msb: 15, lsb: 8, type: 'integer', signedness: 'unsigned' },
      ],
    },
  ],
  activeRegisterId: 'reg-w',
  registerValues: { 'reg-w': '0x0000' },
  theme: 'dark',
  sidebarWidth: 224,
  sidebarCollapsed: false,
  mapTableWidth: 16,
  mapShowGaps: false,
  mapSortDescending: false,
  addressUnitBits: 8,
};

/** Two registers with a gap between them — for show-gaps toggle test. */
const STATE_WITH_GAP = {
  registers: [
    { id: 'reg-lo', name: 'REG_LO', width: 8, offset: 0, fields: [] },
    { id: 'reg-hi', name: 'REG_HI', width: 8, offset: 4, fields: [] },
  ],
  activeRegisterId: 'reg-lo',
  registerValues: { 'reg-lo': '0x00', 'reg-hi': '0x00' },
  theme: 'dark',
  sidebarWidth: 224,
  sidebarCollapsed: false,
  mapTableWidth: 8,
  mapShowGaps: false,
  mapSortDescending: false,
  addressUnitBits: 8,
};

// --- Helpers -------------------------------------------------------------------

async function injectStateAndGoToMap(page: Page, state: Record<string, unknown>) {
  await page.addInitScript((s) => {
    localStorage.setItem('register-viewer-state', JSON.stringify(s));
  }, state);
  await page.goto('/');
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.getByTestId('map-view')).toBeVisible();
}

function mapView(page: Page) {
  return page.getByTestId('map-view');
}

// --- Tests ---------------------------------------------------------------------

test.describe('Map View - Tab Visibility', () => {
  test('map tab appears when registers have offsets', async ({ page }) => {
    await page.addInitScript((s) => {
      localStorage.setItem('register-viewer-state', JSON.stringify(s));
    }, STATE_WITH_OFFSETS);
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Map' })).toBeVisible();
  });

  test('map tab does not appear when no registers have offsets', async ({ page }) => {
    await page.addInitScript((s) => {
      localStorage.setItem('register-viewer-state', JSON.stringify(s));
    }, STATE_NO_OFFSETS);
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Map' })).not.toBeVisible();
  });
});

test.describe('Map View - Click to Navigate', () => {
  test('clicking a register cell navigates to register view', async ({ page }) => {
    await injectStateAndGoToMap(page, STATE_WITH_OFFSETS);

    // Click REG_B in the map
    const regBCell = mapView(page).locator('[title^="REG_B"]');
    await expect(regBCell).toBeVisible();
    await regBCell.click();

    // Should switch to Register tab and show REG_B
    await expect(page.getByRole('heading', { name: 'REG_B' })).toBeVisible();
    // The Register tab should be active (not Map)
    await expect(page.getByRole('button', { name: 'Register', exact: true })).toHaveClass(/border-blue/);
  });
});

test.describe('Map View - Width Selector', () => {
  test('changing width re-layouts the map', async ({ page }) => {
    await injectStateAndGoToMap(page, STATE_WIDE_REGISTER);

    // At 16b width, the 16-bit register should fit in 1 row — 1 register cell
    const cells16b = mapView(page).locator('[title^="WIDE_REG"]');
    await expect(cells16b).toHaveCount(1);

    // Switch to 8b width — register should span 2 rows → 2 cells
    await mapView(page).getByRole('button', { name: '8b', exact: true }).click();
    await expect.poll(() => mapView(page).locator('[title^="WIDE_REG"]').count()).toBe(2);
  });
});

test.describe('Map View - Show Gaps Toggle', () => {
  test('enabling show-gaps reveals gap rows', async ({ page }) => {
    await injectStateAndGoToMap(page, STATE_WITH_GAP);

    // With showGaps off, gap separator dots should appear but no dashed gap rows
    const gapRows = mapView(page).locator('.border-dashed');
    const initialGapCount = await gapRows.count();

    // Enable show gaps
    await mapView(page).getByLabel('Show gaps').check();

    // More dashed-border gap elements should appear
    await expect.poll(() => mapView(page).locator('.border-dashed').count()).toBeGreaterThan(initialGapCount);
  });
});

test.describe('Map View - Field Segments', () => {
  test('register with fields shows field names in map', async ({ page }) => {
    await injectStateAndGoToMap(page, STATE_WITH_OFFSETS);

    // REG_A has fields: EN, MODE, STATUS — they should appear as field segments
    const regACell = mapView(page).locator('[title^="REG_A"]');
    await expect(regACell).toBeVisible();

    // Field names should be visible within the map cell
    await expect(regACell.getByText('EN')).toBeVisible();
    await expect(regACell.getByText('MODE')).toBeVisible();
    await expect(regACell.getByText('STATUS')).toBeVisible();
  });

  test('register without fields does not show field decomposition row', async ({ page }) => {
    await injectStateAndGoToMap(page, STATE_WITH_OFFSETS);

    // REG_B has no fields — should only have the name row, no field segment labels
    const regBCell = mapView(page).locator('[title^="REG_B"]');
    await expect(regBCell).toBeVisible();

    // REG_B cell should not contain field-colored segments (no flex-grow sub-divs with field names)
    const fieldLabels = regBCell.locator('[title]').filter({ hasNotText: /REG_B/ });
    await expect(fieldLabels).toHaveCount(0);
  });
});
