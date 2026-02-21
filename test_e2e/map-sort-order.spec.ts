import { test, expect, type Page } from '@playwright/test';

const TEST_STATE = {
  registers: [
    { id: 'reg-a', name: 'REG_A', width: 8, offset: 0, fields: [] },
    { id: 'reg-b', name: 'REG_B', width: 8, offset: 4, fields: [] },
    { id: 'reg-c', name: 'REG_C', width: 8, offset: 8, fields: [] },
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

/** Inject state via addInitScript so it's set before the app boots. */
async function setupMapState(page: Page) {
  // Only inject state on first load — skip if localStorage already has our test registers,
  // so that the persistence test can verify the app's own save/load round-trip.
  await page.addInitScript((state) => {
    const existing = localStorage.getItem('register-viewer-state');
    if (!existing || !existing.includes('REG_A')) {
      localStorage.setItem('register-viewer-state', JSON.stringify(state));
    }
  }, TEST_STATE);
  await page.goto('/');
  await page.getByRole('button', { name: 'Map' }).click();
}

/**
 * Return the visible register names in map row order (top-to-bottom).
 * Scoped to the map's scrollable container to avoid matching unrelated elements.
 * Assumes each register cell has a title like "REG_NAME (0x00)" — we split on space
 * to extract the name portion.
 */
async function getMapRegisterOrder(page: Page): Promise<string[]> {
  const mapContainer = page.getByTestId('map-view');
  const cells = mapContainer.locator('[title^="REG_"]');
  const count = await cells.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const title = await cells.nth(i).getAttribute('title');
    if (title) {
      names.push(title.split(' ')[0]);
    }
  }
  return names;
}

function sortButton(page: Page) {
  return page.getByRole('button', { name: 'Toggle sort order' });
}

test.describe('Map View - Sort Order', () => {
  test.beforeEach(async ({ page }) => {
    await setupMapState(page);
  });

  test('defaults to ascending order', async ({ page }) => {
    const order = await getMapRegisterOrder(page);
    expect(order).toEqual(['REG_A', 'REG_B', 'REG_C']);
    await expect(sortButton(page)).toContainText('Asc');
  });

  test('clicking sort button switches to descending order', async ({ page }) => {
    await sortButton(page).click();

    await expect.poll(() => getMapRegisterOrder(page)).toEqual(['REG_C', 'REG_B', 'REG_A']);
    await expect(sortButton(page)).toContainText('Desc');
  });

  test('clicking sort button twice returns to ascending order', async ({ page }) => {
    await sortButton(page).click();
    await sortButton(page).click();

    await expect.poll(() => getMapRegisterOrder(page)).toEqual(['REG_A', 'REG_B', 'REG_C']);
    await expect(sortButton(page)).toContainText('Asc');
  });

  test('sort order persists across page reload', async ({ page }) => {
    await sortButton(page).click();
    await expect(sortButton(page)).toContainText('Desc');

    // Reload — the app saves state to localStorage on beforeunload, then loads it on boot
    await page.reload();
    await page.getByRole('button', { name: 'Map' }).click();

    await expect(sortButton(page)).toContainText('Desc');
    await expect.poll(() => getMapRegisterOrder(page)).toEqual(['REG_C', 'REG_B', 'REG_A']);
  });
});
