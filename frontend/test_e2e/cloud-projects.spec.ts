import { test, expect, type Page, type Route } from '@playwright/test';

// A valid project data payload that importFromJson can parse
const MOCK_PROJECT_DATA = {
  version: 1,
  registers: [
    {
      name: 'CLOUD_REG',
      width: 32,
      fields: [
        { name: 'ENABLE', msb: 0, lsb: 0, type: 'flag' },
      ],
    },
  ],
  registerValues: { CLOUD_REG: '0xCAFEBABE' },
  project: { title: 'Cloud Test Project' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clear storage and reload so the app creates the default seed project. */
async function resetApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
}

function hexInput(page: Page) {
  return page.locator('label').filter({ hasText: 'HEX' }).locator('input');
}

async function openMyProjects(page: Page) {
  await page.getByRole('button', { name: 'Application menu' }).click();
  await page.getByRole('menuitem', { name: 'My Projects' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function openShareDialog(page: Page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** Save the current project to cloud via My Projects dialog (first-time save flow). */
async function saveToCloudViaMyProjects(page: Page) {
  await openMyProjects(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Save project.*to cloud/ }).click();
  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button', { name: 'Save to Cloud' }).click();
  // Wait for save to complete — visibility badge appears
  await expect(dialog.getByRole('button', { name: /Visibility: private for Example Project/ })).toBeVisible({ timeout: 5000 });
  // Close My Projects dialog
  await page.keyboard.press('Escape');
  // After save, "Update cloud copy" button should appear in header
  await expect(page.getByRole('button', { name: 'Update cloud copy' })).toBeVisible({ timeout: 5000 });
}

/**
 * Set up route interception for all cloud API calls.
 *
 * Uses a regex that matches `/api/projects` in any URL regardless of origin,
 * so it works whether VITE_API_URL is a mock host or a real API server.
 * Must be called BEFORE navigating or triggering cloud operations.
 */
async function mockCloudApi(page: Page, options: {
  cloudId?: string;
  /** Override for POST /api/projects (create). */
  createResponse?: { status: number; body: unknown };
  /** Override for GET /api/projects/:id (load single project). */
  getResponse?: { status: number; body: unknown };
  /** Override for PUT /api/projects/:id (update). */
  updateResponse?: { status: number; body: unknown };
  /** Override for PATCH /api/projects/:id (visibility). */
  patchResponse?: { status: number; body: unknown };
  /** Status code for DELETE /api/projects/:id. Default: 204. */
  deleteStatus?: number;
  /** Override for GET /api/projects (list). */
  listResponse?: { status: number; body: unknown };
  /** Callback invoked on every intercepted request (for tracking). */
  onRequest?: (method: string, url: string, body: unknown) => void;
} = {}) {
  const cloudId = options.cloudId ?? 'mockCloud123';
  const now = new Date().toISOString();

  // Match any URL containing /api/projects (works with any VITE_API_URL origin)
  await page.route(
    /\/api\/projects/,
    async (route: Route) => {
      const method = route.request().method();
      const url = route.request().url();
      const urlObj = new URL(url);
      const path = urlObj.pathname;

      // Parse request body for tracking
      let body: unknown = null;
      try { body = route.request().postDataJSON(); } catch { /* no body */ }
      options.onRequest?.(method, url, body);

      // Check if path ends with /api/projects (no trailing ID)
      const isCollectionEndpoint = /\/api\/projects\/?$/.test(path);

      if (isCollectionEndpoint) {
        if (method === 'POST') {
          const resp = options.createResponse ?? {
            status: 200,
            body: { id: cloudId, shareUrl: `${urlObj.origin}/#/p/${cloudId}`, createdAt: now },
          };
          await route.fulfill({
            status: resp.status,
            contentType: 'application/json',
            body: JSON.stringify(resp.body),
          });
          return;
        }
        if (method === 'GET') {
          const resp = options.listResponse ?? {
            status: 200,
            body: { projects: [] },
          };
          await route.fulfill({
            status: resp.status,
            contentType: 'application/json',
            body: JSON.stringify(resp.body),
          });
          return;
        }
      }

      // Match: /api/projects/:id
      const idMatch = path.match(/\/api\/projects\/([^/]+)\/?$/);
      if (idMatch) {
        const projectId = decodeURIComponent(idMatch[1]);

        if (method === 'GET') {
          const resp = options.getResponse ?? {
            status: 200,
            body: { id: projectId, data: MOCK_PROJECT_DATA, createdAt: now, updatedAt: now },
          };
          await route.fulfill({
            status: resp.status,
            contentType: 'application/json',
            body: JSON.stringify(resp.body),
          });
          return;
        }
        if (method === 'PUT') {
          const resp = options.updateResponse ?? {
            status: 200,
            body: { id: projectId, updatedAt: new Date().toISOString() },
          };
          await route.fulfill({
            status: resp.status,
            contentType: 'application/json',
            body: JSON.stringify(resp.body),
          });
          return;
        }
        if (method === 'PATCH') {
          const resp = options.patchResponse ?? {
            status: 200,
            body: { id: projectId, updatedAt: new Date().toISOString() },
          };
          await route.fulfill({
            status: resp.status,
            contentType: 'application/json',
            body: JSON.stringify(resp.body),
          });
          return;
        }
        if (method === 'DELETE') {
          const status = options.deleteStatus ?? 204;
          await route.fulfill({
            status,
            contentType: 'application/json',
            body: status === 204 ? '' : JSON.stringify({ error: 'Not found' }),
          });
          return;
        }
      }

      await route.continue();
    },
  );
}

// ---------------------------------------------------------------------------
// Test: Save to cloud (first time via My Projects dialog)
// ---------------------------------------------------------------------------

test.describe('Cloud: Save to cloud', () => {
  test('saves project to cloud via My Projects and updates UI', async ({ page }) => {
    const now = new Date().toISOString();
    await mockCloudApi(page, {
      // List must include the created project so sync doesn't mark it stale
      listResponse: {
        status: 200,
        body: {
          projects: [{
            id: 'mockCloud123',
            visibility: 'private',
            createdAt: now,
            updatedAt: now,
          }],
        },
      },
    });
    await resetApp(page);

    // Header save button should NOT be visible for local-only projects
    await expect(page.getByRole('button', { name: 'Save to cloud' })).not.toBeVisible();

    // Save via My Projects dialog
    await saveToCloudViaMyProjects(page);

    // After saving, the save button tooltip should show "Update cloud copy"
    await expect(page.getByRole('button', { name: 'Update cloud copy' })).toBeVisible({ timeout: 5000 });

    // The URL hash should now contain a cloud project ID
    await expect(page).toHaveURL(/#\/p\/\w+/);

    // Open My Projects and verify cloud indicator
    await openMyProjects(page);
    const dialog = page.getByRole('dialog');

    // The project should show as cloud-saved (visibility badge should appear)
    await expect(dialog.getByRole('button', { name: /Visibility: private for Example Project/ })).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Test: Save to cloud from My Projects dialog
// ---------------------------------------------------------------------------

test.describe('Cloud: Save to cloud from My Projects', () => {
  test('saves project to cloud via My Projects dialog', async ({ page }) => {
    await mockCloudApi(page);
    await resetApp(page);

    await openMyProjects(page);
    const dialog = page.getByRole('dialog');

    // Click the "Save to cloud" button on the project
    await dialog.getByRole('button', { name: /Save project.*to cloud/ }).click();

    // First-time confirmation dialog should appear
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByRole('heading', { name: 'Save to Cloud' })).toBeVisible();
    await expect(confirmDialog.getByText('uploaded to our servers')).toBeVisible();

    // Confirm the save
    await confirmDialog.getByRole('button', { name: 'Save to Cloud' }).click();

    // Wait for the save to complete — the project should now show as cloud-saved
    await expect(dialog.getByRole('button', { name: /Visibility: private for Example Project/ })).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Test: Open shared cloud project via URL
// ---------------------------------------------------------------------------

test.describe('Cloud: Open shared project', () => {
  test('loads a cloud project from #/p/{cloudId} URL', async ({ page }) => {
    await mockCloudApi(page, {
      getResponse: {
        status: 200,
        body: {
          id: 'shPrj1abc123',
          data: MOCK_PROJECT_DATA,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    });

    // Navigate directly to a cloud project URL
    await page.goto('/#/p/shPrj1abc123');

    // The cloud project data should load
    await expect(page.getByRole('heading', { name: 'CLOUD_REG' })).toBeVisible({ timeout: 10000 });
    await expect(hexInput(page)).toHaveValue('CAFEBABE');

    // Should show the shared project banner (user is not owner)
    await expect(page.getByText('Viewing a shared project')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save your own copy' })).toBeVisible();
  });

  test('shows error when cloud project returns 404', async ({ page }) => {
    await mockCloudApi(page, {
      getResponse: {
        status: 404,
        body: { error: 'Not found' },
      },
    });

    // Navigate to a non-existent cloud project
    await page.goto('/#/p/noExist12345');

    // Should show error page
    await expect(page.getByText('Unable to load project')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/not found/i)).toBeVisible();

    // Click Continue button to load default state
    await page.getByRole('button', { name: 'Continue to Register Viewer' }).click();

    // Should load the default/most-recent project
    await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Test: Fork a shared project ("Save your own copy")
// ---------------------------------------------------------------------------

test.describe('Cloud: Fork shared project', () => {
  test('clicking "Save your own copy" creates a new cloud project', async ({ page }) => {
    await mockCloudApi(page);

    // Open shared project
    await page.goto('/#/p/shOrignal123');
    await expect(page.getByText('Viewing a shared project')).toBeVisible({ timeout: 10000 });

    // Click "Save your own copy"
    await page.getByRole('button', { name: 'Save your own copy' }).click();

    // After fork, user becomes owner — banner should disappear
    await expect(page.getByText('Viewing a shared project')).not.toBeVisible({ timeout: 5000 });

    // URL should now contain a cloud project ID (the forked copy)
    await expect(page).toHaveURL(/#\/p\/\w+/);

    // Save button should show "Update cloud copy" (owner of the fork)
    await expect(page.getByRole('button', { name: 'Update cloud copy' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test: Update existing cloud project
// ---------------------------------------------------------------------------

test.describe('Cloud: Update cloud project', () => {
  test('updates an existing cloud project after editing', async ({ page }) => {
    const requests: { method: string; url: string }[] = [];

    await mockCloudApi(page, {
      onRequest: (method, url) => {
        requests.push({ method, url });
      },
    });
    await resetApp(page);

    // Save to cloud first via My Projects
    await saveToCloudViaMyProjects(page);

    // Clear tracked requests from the initial save
    requests.length = 0;

    // Edit a register value
    await hexInput(page).fill('12345678');
    await hexInput(page).blur();

    // Click update
    await page.getByRole('button', { name: 'Update cloud copy' }).click();

    // Wait for the PUT request to be captured by the mock
    await expect.poll(() => requests.filter(r => r.method === 'PUT').length, {
      message: 'Expected at least one PUT request after clicking update',
      timeout: 5000,
    }).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Test: Delete from cloud via My Projects
// ---------------------------------------------------------------------------

test.describe('Cloud: Delete from cloud', () => {
  test('removes cloud copy while keeping local project', async ({ page }) => {
    await mockCloudApi(page);
    await resetApp(page);

    // Save to cloud first via My Projects
    await saveToCloudViaMyProjects(page);

    // Open My Projects
    await openMyProjects(page);
    const dialog = page.getByRole('dialog');

    // Click "Remove from cloud" button
    const removeBtn = dialog.getByRole('button', { name: /Remove project.*from cloud/ });
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    // Confirmation dialog should appear
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByText('Shared links will stop working')).toBeVisible();

    // Confirm removal
    await confirmDialog.getByRole('button', { name: 'Remove from Cloud' }).click();

    // Project should still exist in the list (local copy preserved)
    await expect(dialog.getByText('1 project')).toBeVisible({ timeout: 5000 });

    // But no longer cloud-saved — "Private" visibility badge should be gone
    await expect(dialog.getByRole('button', { name: /Visibility: private for Example Project/ })).not.toBeVisible();

    // Close dialog — header save button should be hidden (local-only project)
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Update cloud copy' })).not.toBeVisible();

    // URL hash should be cleared
    const url = page.url();
    expect(url).not.toContain('#/p/');
  });
});

// ---------------------------------------------------------------------------
// Test: Visibility change (private -> unlisted) via Share dialog
// ---------------------------------------------------------------------------

test.describe('Cloud: Visibility change', () => {
  test('changes visibility from private to unlisted via Share dialog', async ({ page }) => {
    await mockCloudApi(page);
    await resetApp(page);

    // Save to cloud first via My Projects
    await saveToCloudViaMyProjects(page);

    // Open share dialog via header Share button
    await openShareDialog(page);
    const dialog = page.getByRole('dialog');

    // State B: cloud + private — should see "Make Unlisted" button
    await expect(dialog.getByText('This project is private')).toBeVisible();
    await dialog.getByRole('button', { name: 'Make Unlisted' }).click();

    // After making unlisted, should switch to State A — show the cloud link
    await expect(dialog.getByText('Anyone with this link can view')).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText('Unlisted')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test: Share dialog shows "Save to Cloud" for local-only projects
// ---------------------------------------------------------------------------

test.describe('Cloud: Share dialog cloud section states', () => {
  test('shows "Save to Cloud" button for local-only projects', async ({ page }) => {
    await mockCloudApi(page);
    await resetApp(page);

    // Open share dialog without saving to cloud first
    await openShareDialog(page);
    const dialog = page.getByRole('dialog');

    // State C: not cloud-saved — should see "Save to Cloud" button
    await expect(dialog.getByText('Save to the cloud for a short, permanent link')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save to Cloud' })).toBeVisible();
  });

  test('saves to cloud from Share dialog with first-time prompt', async ({ page }) => {
    await mockCloudApi(page);
    await resetApp(page);

    // Open share dialog
    await openShareDialog(page);
    const dialog = page.getByRole('dialog');

    // Click "Save to Cloud" in the share dialog
    await dialog.getByRole('button', { name: 'Save to Cloud' }).click();

    // First-time confirmation dialog should appear
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByText('uploaded to our servers')).toBeVisible();

    // Confirm
    await confirmDialog.getByRole('button', { name: 'Save to Cloud' }).click();

    // After saving, dialog should show the cloud link (State B: private)
    await expect(dialog.getByText('This project is private')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Test: Cloud sync detects stale projects on My Projects open
// ---------------------------------------------------------------------------

test.describe('Cloud: Sync detects stale cloud projects', () => {
  test('shows warning for projects deleted from cloud server', async ({ page }) => {
    // Mock API: create succeeds, but list returns empty (project deleted from server)
    await mockCloudApi(page, {
      listResponse: {
        status: 200,
        body: { projects: [] },
      },
    });

    await resetApp(page);

    // Save to cloud via My Projects
    await saveToCloudViaMyProjects(page);

    // Open My Projects — sync should detect the project is stale
    await openMyProjects(page);
    const dialog = page.getByRole('dialog');

    // Should show "Cloud copy not found" warning
    await expect(dialog.getByText('Cloud copy not found')).toBeVisible({ timeout: 5000 });

    // Should offer "Remove link" option
    await expect(dialog.getByText('Remove link')).toBeVisible();
  });

  test('clicking "Remove link" clears stale cloud association', async ({ page }) => {
    await mockCloudApi(page, {
      listResponse: {
        status: 200,
        body: { projects: [] },
      },
    });

    await resetApp(page);

    // Save to cloud first via My Projects
    await saveToCloudViaMyProjects(page);

    // Open My Projects — sync detects stale project
    await openMyProjects(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Cloud copy not found')).toBeVisible({ timeout: 5000 });

    // Click "Remove link"
    await dialog.getByText('Remove link').click();

    // Warning should disappear
    await expect(dialog.getByText('Cloud copy not found')).not.toBeVisible({ timeout: 5000 });

    // Close dialog — header save button should be hidden (local-only now)
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Update cloud copy' })).not.toBeVisible();

    // URL hash should be cleared
    const url = page.url();
    expect(url).not.toContain('#/p/');
  });
});

// ---------------------------------------------------------------------------
// Test: Owner re-opens their own cloud project via URL
// ---------------------------------------------------------------------------

test.describe('Cloud: Owner opens own project via URL', () => {
  test('reloading a cloud URL the owner saved preserves ownership state', async ({ page }) => {
    await mockCloudApi(page);
    await resetApp(page);

    // Save to cloud to establish ownership via My Projects
    await saveToCloudViaMyProjects(page);

    // Get the current cloud URL hash
    const url = page.url();
    expect(url).toContain('#/p/');

    // Reload the page (simulates reopening the same cloud URL)
    await page.reload();

    // Should load the project data from the mock (CLOUD_REG from MOCK_PROJECT_DATA)
    await expect(page.getByRole('heading', { name: 'CLOUD_REG' })).toBeVisible({ timeout: 10000 });

    // Should show "Update cloud copy" — proves the user is recognized as owner
    await expect(page.getByRole('button', { name: 'Update cloud copy' })).toBeVisible({ timeout: 5000 });

    // Shared project banner should not be visible (user is owner)
    await expect(page.getByText('Viewing a shared project')).not.toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Test: API failure scenarios
// ---------------------------------------------------------------------------

test.describe('Cloud: API failure handling', () => {
  test('shows error toast when initial save fails (500)', async ({ page }) => {
    await mockCloudApi(page, {
      createResponse: {
        status: 500,
        body: { error: 'Internal server error' },
      },
    });
    await resetApp(page);

    // Try to save to cloud via My Projects
    await openMyProjects(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Save project.*to cloud/ }).click();
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Save to Cloud' }).click();

    // Should show error toast (use the fixed-position toast, not the sr-only announcer)
    const toast = page.locator('.fixed[role="alert"]');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Internal server error');

    // Header save button should not be visible (still local-only)
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Update cloud copy' })).not.toBeVisible();

    // URL should NOT contain a cloud project ID
    expect(page.url()).not.toContain('#/p/');
  });

  test('shows error toast when update fails (500)', async ({ page }) => {
    await mockCloudApi(page, {
      updateResponse: {
        status: 500,
        body: { error: 'Failed to update project' },
      },
    });
    await resetApp(page);

    // Save to cloud first (create succeeds) via My Projects
    await saveToCloudViaMyProjects(page);

    // Now click update — PUT will fail
    await page.getByRole('button', { name: 'Update cloud copy' }).click();

    // Should show error toast
    const toast = page.locator('.fixed[role="alert"]');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText('Failed to update project');
  });

  test('handles update 404 by clearing cloud state', async ({ page }) => {
    // Create succeeds, but then update returns 404 (project deleted on server)
    await mockCloudApi(page, {
      updateResponse: {
        status: 404,
        body: { error: 'Not found' },
      },
    });
    await resetApp(page);

    // Save to cloud first via My Projects
    await saveToCloudViaMyProjects(page);

    // Click update — server returns 404
    await page.getByRole('button', { name: 'Update cloud copy' }).click();

    // Should show error about cloud project not found
    const toast = page.locator('.fixed[role="alert"]');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/not found/i);

    // Header save button should be hidden (cloud state cleared, now local-only)
    await expect(page.getByRole('button', { name: 'Update cloud copy' })).not.toBeVisible({ timeout: 5000 });

    // URL hash should be cleared
    expect(page.url()).not.toContain('#/p/');
  });
});

// ---------------------------------------------------------------------------
// Test: Copy cloud link in Share dialog
// ---------------------------------------------------------------------------

test.describe('Cloud: Copy cloud link', () => {
  test('share dialog shows copyable cloud link when unlisted', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await mockCloudApi(page);
    await resetApp(page);

    // Save to cloud via My Projects
    await saveToCloudViaMyProjects(page);

    // Open share dialog and make unlisted
    await openShareDialog(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('This project is private')).toBeVisible();
    await dialog.getByRole('button', { name: 'Make Unlisted' }).click();

    // State A: should show cloud link input with the URL
    await expect(dialog.getByText('Anyone with this link can view')).toBeVisible({ timeout: 5000 });
    const linkInput = dialog.locator('input[readonly]').last();
    const linkValue = await linkInput.inputValue();
    expect(linkValue).toContain('#/p/');

    // Click the copy button
    await dialog.getByRole('button', { name: 'Copy cloud link' }).click();

    // Verify clipboard contains the link
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('#/p/');
    expect(clipboardText).toBe(linkValue);
  });
});
