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

/**
 * Build a fake JWT that passes the frontend's `parseJwtPayload` check.
 * The signature is bogus — only the base64url-encoded payload matters
 * because the frontend never verifies signatures (the real API does).
 */
function buildMockJwt(): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: 1,
    email: 'test@example.com',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400, // 24 h
    jti: 'test-jti',
  };
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64url(header)}.${b64url(payload)}.mock-signature`;
}

const MOCK_JWT = buildMockJwt();

/**
 * Set up mock auth: intercept `/api/auth/me` and use `addInitScript` to
 * inject a mock JWT into localStorage before React mounts on every navigation.
 * Call this BEFORE navigating to the app.
 */
async function setupMockAuth(page: Page) {
  await page.route(/\/api\/auth\/me/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: { id: 1, email: 'test@example.com' } }),
    });
  });
  await page.addInitScript((jwt) => {
    localStorage.setItem('register-viewer-jwt', jwt);
  }, MOCK_JWT);
}

/** Clear storage and reload so the app creates the default seed project (unsaved). */
async function resetApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
}

/** Save the current unsaved project via the app menu's "Save project" item. */
async function saveUnsavedProject(page: Page) {
  await page.getByRole('button', { name: 'Application menu' }).click();
  await page.getByRole('menuitem', { name: 'Save project' }).click();
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

/**
 * Wait for the sync indicator to show "Saved to cloud" status.
 */
async function waitForCloudSync(page: Page) {
  await expect(page.getByTitle('Saved to cloud')).toBeVisible({ timeout: 10000 });
}

/**
 * Explicitly save the active project to cloud via the My Projects dialog.
 * In the local-first model, projects are NOT auto-uploaded on sign-in;
 * users must click the "Save to cloud" button.
 */
async function saveActiveProjectToCloud(page: Page) {
  await openMyProjects(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByTitle('Save to cloud').click();
  // Close the dialog
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  // Wait for sync to complete
  await waitForCloudSync(page);
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

  // Stateful project list: starts empty; POST appends; DELETE removes.
  // This mirrors the real API so that GET /api/projects list syncs (stale-
  // reconciliation introduced in dec56c5) see the created project and don't
  // demote it to local-only when My Projects is re-opened.
  type ListEntry = { id: string; title: string; visibility: string; updatedAt: string; version: number };
  const createdProjects: ListEntry[] = [];

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
          const defaultBody = { id: cloudId, shareUrl: `${urlObj.origin}/#/p/${cloudId}`, createdAt: now, version: 1 };
          const resp = options.createResponse ?? { status: 200, body: defaultBody };
          await route.fulfill({
            status: resp.status,
            contentType: 'application/json',
            body: JSON.stringify(resp.body),
          });
          // Record the created project so the list endpoint reflects it.
          // Only record on success (2xx) and when using the default response
          // (caller-supplied createResponse may be an error stub).
          if (resp.status >= 200 && resp.status < 300 && !options.createResponse) {
            const postBody = body as Record<string, unknown> | null;
            createdProjects.push({
              id: cloudId,
              title: (postBody?.data as Record<string, unknown> | null)?.project
                ? ((postBody.data as Record<string, unknown>).project as Record<string, unknown>)?.title as string ?? 'Untitled'
                : 'Untitled',
              visibility: 'private',
              updatedAt: now,
              version: 1,
            });
          }
          return;
        }
        if (method === 'GET') {
          // Use caller-supplied override when provided; otherwise return the
          // stateful list so sync does not demote just-created cloud projects.
          const resp = options.listResponse ?? {
            status: 200,
            body: { projects: createdProjects },
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
            body: { id: projectId, data: MOCK_PROJECT_DATA, createdAt: now, updatedAt: now, isOwner: true, version: 1 },
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
            body: { id: projectId, updatedAt: new Date().toISOString(), version: 2 },
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
            body: { id: projectId, updatedAt: new Date().toISOString(), version: 2 },
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
          // Remove from the stateful list so post-delete syncs don't resurrect it.
          if (status >= 200 && status < 300) {
            const idx = createdProjects.findIndex(p => p.id === projectId);
            if (idx !== -1) createdProjects.splice(idx, 1);
          }
          return;
        }
      }

      await route.continue();
    },
  );
}

// ---------------------------------------------------------------------------
// Test: Explicit save to cloud via My Projects dialog
// ---------------------------------------------------------------------------

test.describe('Cloud: Explicit save to cloud', () => {
  test('saves project to cloud via My Projects and shows sync indicator', async ({ page }) => {
    await setupMockAuth(page);
    await mockCloudApi(page);
    await resetApp(page);
    await saveUnsavedProject(page);

    // No sync indicator should be visible for a local-only project
    await expect(page.getByTitle('Saved to cloud')).not.toBeVisible({ timeout: 2000 });

    // Explicitly save to cloud via My Projects dialog
    await saveActiveProjectToCloud(page);

    // The URL hash should contain a cloud project ID
    await expect(page).toHaveURL(/#\/p\/\w+/);
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
          isOwner: false,
          version: 1,
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
    await setupMockAuth(page);
    await mockCloudApi(page, {
      getResponse: {
        status: 200,
        body: {
          id: 'shOrignal123',
          data: MOCK_PROJECT_DATA,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isOwner: false,
          version: 1,
        },
      },
    });

    // Open shared project
    await page.goto('/#/p/shOrignal123');
    await expect(page.getByText('Viewing a shared project')).toBeVisible({ timeout: 10000 });

    // Click "Save your own copy"
    await page.getByRole('button', { name: 'Save your own copy' }).click();

    // After fork, user becomes owner — banner should disappear
    await expect(page.getByText('Viewing a shared project')).not.toBeVisible({ timeout: 5000 });

    // URL should now contain a cloud project ID (the forked copy)
    await expect(page).toHaveURL(/#\/p\/\w+/);
  });
});

// ---------------------------------------------------------------------------
// Test: Auto-sync updates cloud after editing
// ---------------------------------------------------------------------------

test.describe('Cloud: Auto-sync after edit', () => {
  test('auto-syncs to cloud after editing a register value', async ({ page }) => {
    const requests: { method: string; url: string }[] = [];

    await setupMockAuth(page);
    await mockCloudApi(page, {
      onRequest: (method, url) => {
        requests.push({ method, url });
      },
    });
    await resetApp(page);
    await saveUnsavedProject(page);

    // Explicitly save to cloud first
    await saveActiveProjectToCloud(page);

    // Clear tracked requests from the initial save
    requests.length = 0;

    // Edit a register value
    await hexInput(page).fill('12345678');
    await hexInput(page).blur();

    // Wait for the auto-sync PUT request (debounced ~3s)
    await expect.poll(() => requests.filter(r => r.method === 'PUT').length, {
      message: 'Expected at least one PUT request after editing',
      timeout: 10000,
    }).toBeGreaterThanOrEqual(1);

    // Sync indicator should return to "Saved"
    await waitForCloudSync(page);
  });
});

// ---------------------------------------------------------------------------
// Test: Visibility change (private -> unlisted) via Share dialog
// ---------------------------------------------------------------------------

test.describe('Cloud: Visibility change', () => {
  test('changes visibility from private to unlisted via Share dialog', async ({ page }) => {
    await setupMockAuth(page);
    await mockCloudApi(page);
    await resetApp(page);
    await saveUnsavedProject(page);

    // Explicitly save to cloud first
    await saveActiveProjectToCloud(page);

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
// Test: Share dialog cloud section states
// ---------------------------------------------------------------------------

test.describe('Cloud: Share dialog cloud section states', () => {
  test('shows sign-in prompt for anonymous users', async ({ page }) => {
    await mockCloudApi(page);
    await resetApp(page);

    // Open share dialog without being signed in
    await openShareDialog(page);
    const dialog = page.getByRole('dialog');

    // State C: not signed in — should see sign-in prompt (no Save to Cloud button)
    await expect(dialog.getByText('Sign in to share this project via link.')).toBeVisible();
  });

  test('share dialog shows private state after saving to cloud', async ({ page }) => {
    await setupMockAuth(page);
    await mockCloudApi(page);
    await resetApp(page);
    await saveUnsavedProject(page);

    // Explicitly save to cloud first
    await saveActiveProjectToCloud(page);

    // Open share dialog — project is already cloud-saved via explicit save
    await openShareDialog(page);
    const dialog = page.getByRole('dialog');

    // State B: cloud + private — should show private indicator
    await expect(dialog.getByText('This project is private')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Test: Owner re-opens their own cloud project via URL
// ---------------------------------------------------------------------------

test.describe('Cloud: Owner opens own project via URL', () => {
  test('reloading a cloud URL the owner saved preserves ownership state', async ({ page }) => {
    const now = new Date().toISOString();
    await setupMockAuth(page);
    await mockCloudApi(page, {
      // When reloading, the GET response should indicate the user is the owner
      getResponse: {
        status: 200,
        body: { id: 'mockCloud123', data: MOCK_PROJECT_DATA, createdAt: now, updatedAt: now, isOwner: true, version: 1 },
      },
    });
    await resetApp(page);
    await saveUnsavedProject(page);

    // Explicitly save to cloud to establish cloud ownership
    await saveActiveProjectToCloud(page);

    // Get the current cloud URL hash
    const url = page.url();
    expect(url).toContain('#/p/');

    // Reload the page (simulates reopening the same cloud URL)
    await page.reload();

    // Should load the project data from the mock (CLOUD_REG from MOCK_PROJECT_DATA)
    await expect(page.getByRole('heading', { name: 'CLOUD_REG' })).toBeVisible({ timeout: 10000 });

    // Sync indicator should show "Saved to cloud" (owner recognized)
    await waitForCloudSync(page);

    // Shared project banner should not be visible (user is owner)
    await expect(page.getByText('Viewing a shared project')).not.toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Test: Copy cloud link in Share dialog
// ---------------------------------------------------------------------------

test.describe('Cloud: Copy cloud link', () => {
  test('share dialog shows copyable cloud link when unlisted', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await setupMockAuth(page);
    await mockCloudApi(page);
    await resetApp(page);
    await saveUnsavedProject(page);

    // Explicitly save to cloud first
    await saveActiveProjectToCloud(page);

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

// ---------------------------------------------------------------------------
// Test: Delete project also removes cloud copy
// ---------------------------------------------------------------------------

test.describe('Cloud: Delete removes cloud copy', () => {
  test('deleting a cloud-backed project sends DELETE to API', async ({ page }) => {
    const requests: { method: string; url: string }[] = [];
    await setupMockAuth(page);
    await mockCloudApi(page, {
      onRequest: (method, url) => {
        requests.push({ method, url });
      },
    });
    await resetApp(page);
    await saveUnsavedProject(page);

    // Explicitly save to cloud first
    await saveActiveProjectToCloud(page);

    // Open My Projects and delete the project
    await openMyProjects(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Delete project/ }).click();
    await dialog.getByRole('button', { name: /Delete project/ }).click();

    // Should have sent a DELETE request to the API
    await expect.poll(() => requests.filter(r => r.method === 'DELETE').length, {
      message: 'Expected a DELETE request after deleting cloud-backed project',
      timeout: 5000,
    }).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Test: Sign in does NOT auto-upload local projects
// ---------------------------------------------------------------------------

test.describe('Cloud: No auto-upload on sign-in', () => {
  test('signing in does not automatically upload existing local projects', async ({ page }) => {
    const requests: { method: string; url: string }[] = [];

    // Start anonymous — create a local project
    await mockCloudApi(page, {
      onRequest: (method, url) => {
        requests.push({ method, url });
      },
    });
    await resetApp(page);

    // Now set up auth (simulates signing in)
    await setupMockAuth(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible({ timeout: 10000 });

    // Wait a beat for any async operations to settle
    await page.waitForTimeout(3000);

    // No POST to /api/projects should have been made (no auto-upload)
    const postRequests = requests.filter(r => r.method === 'POST' && /\/api\/projects\/?$/.test(new URL(r.url).pathname));
    expect(postRequests).toHaveLength(0);

    // No sync indicator should be visible (project is still local-only)
    await expect(page.getByTitle('Saved to cloud')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test: Remove from Cloud returns project to local-only
// ---------------------------------------------------------------------------

test.describe('Cloud: Remove from Cloud', () => {
  test('removing from cloud returns project to local-only state', async ({ page }) => {
    await setupMockAuth(page);
    await mockCloudApi(page);
    await resetApp(page);
    await saveUnsavedProject(page);

    // Save to cloud first
    await saveActiveProjectToCloud(page);
    await waitForCloudSync(page);

    // Open My Projects and click "Remove from cloud"
    await openMyProjects(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByTitle('Remove from cloud').click();

    // Close dialog
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Sync indicator should disappear (project is local-only again)
    await expect(page.getByTitle('Saved to cloud')).not.toBeVisible({ timeout: 5000 });

    // Project data should still be visible (not lost)
    await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test: Sign out purges cloud projects from localStorage
// ---------------------------------------------------------------------------

test.describe('Cloud: Sign-out purge', () => {
  test('signing out purges cloud projects and loads default project', async ({ page }) => {
    await setupMockAuth(page);
    await mockCloudApi(page);

    // Mock the logout endpoint
    await page.route(/\/api\/auth\/logout/, async (route) => {
      await route.fulfill({ status: 204, body: '' });
    });

    await resetApp(page);
    await saveUnsavedProject(page);

    // Save to cloud so the project has storage: 'cloud'
    await saveActiveProjectToCloud(page);
    await waitForCloudSync(page);

    // Sign out via the application menu
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();

    // Cloud project was purged; app creates a new blank project
    await expect(page.getByText('No register selected')).toBeVisible({ timeout: 10000 });

    // Sync indicator should not be visible (no longer cloud-backed)
    await expect(page.getByTitle('Saved to cloud')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test: Delete confirmation shows cloud warning
// ---------------------------------------------------------------------------

test.describe('Cloud: Delete confirmation cloud warning', () => {
  test('delete confirmation warns about cloud copy for cloud-backed project', async ({ page }) => {
    await setupMockAuth(page);
    await mockCloudApi(page);
    await resetApp(page);
    await saveUnsavedProject(page);

    // Save to cloud first
    await saveActiveProjectToCloud(page);

    // Open My Projects and click the delete button to trigger confirmation
    await openMyProjects(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Delete project/ }).click();

    // Cloud warning should be visible in the confirmation
    await expect(dialog.getByText('This will also delete the cloud copy')).toBeVisible();

    // Cancel to verify this is just a confirmation check
    await dialog.getByRole('button', { name: 'Cancel deletion' }).click();
  });
});

// ---------------------------------------------------------------------------
// Test: Share dialog prompts Save to Cloud for signed-in local project
// ---------------------------------------------------------------------------

test.describe('Cloud: Share dialog save-to-cloud prompt', () => {
  test('share dialog shows Save to Cloud prompt for local-only project when signed in', async ({ page }) => {
    await setupMockAuth(page);
    await mockCloudApi(page);
    await resetApp(page);
    await saveUnsavedProject(page);

    // Project is local-only (not saved to cloud yet)
    // Open share dialog
    await openShareDialog(page);
    const dialog = page.getByRole('dialog');

    // State D: signed in, local project — should show save-to-cloud prompt
    await expect(dialog.getByText('Save to Cloud to share this project via link.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save to Cloud' })).toBeVisible();
  });
});
