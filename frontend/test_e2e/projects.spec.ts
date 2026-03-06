import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Storage keys (must match src/utils/project-storage.ts)
// ---------------------------------------------------------------------------
const PROJECT_PREFIX = 'register-viewer-project:';
const UNSAVED_KEY = 'register-viewer-unsaved';
const ACTIVE_PROJECT_SESSION_KEY = 'register-viewer-active-project';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clear localStorage so the app starts fresh (creates default unsaved seed project). */
async function resetApp(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  // Wait for the seed project to load
  await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
}

/** Open the Application menu, then click "My Projects". */
async function openMyProjects(page: Page) {
  await page.getByRole('button', { name: 'Application menu' }).click();
  await page.getByRole('menuitem', { name: 'My Projects' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** Create a new project via the Application menu. Handles unsaved guard if needed. */
async function createNewProjectViaMenu(page: Page) {
  await page.getByRole('button', { name: 'Application menu' }).click();
  await page.getByRole('menuitem', { name: 'New project' }).click();

  // If an unsaved guard dialog appears, discard the unsaved project
  const discardButton = page.getByRole('alertdialog').getByRole('button', { name: 'Discard' });
  if (await discardButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await discardButton.click();
  }
}

/** Save the current unsaved project via the app menu's "Save project" item. */
async function saveUnsavedProject(page: Page) {
  await page.getByRole('button', { name: 'Application menu' }).click();
  await page.getByRole('menuitem', { name: 'Save project' }).click();
}

function hexInput(page: Page) {
  return page.locator('label').filter({ hasText: 'HEX' }).locator('input');
}

/**
 * Wait for auto-save to flush by checking that any stored project or the
 * unsaved project key contains the expected substring.
 */
async function waitForAutoSave(page: Page, expectedSubstring: string) {
  const needle = expectedSubstring.toLowerCase();
  await expect(async () => {
    const found = await page.evaluate(({ prefix, unsavedKey, search }) => {
      // Check saved project keys
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          const val = localStorage.getItem(key);
          if (val && val.toLowerCase().includes(search)) return true;
        }
      }
      // Check unsaved project key
      const unsaved = localStorage.getItem(unsavedKey);
      if (unsaved && unsaved.toLowerCase().includes(search)) return true;
      return false;
    }, { prefix: PROJECT_PREFIX, unsavedKey: UNSAVED_KEY, search: needle });
    expect(found).toBe(true);
  }).toPass({ timeout: 5000 });
}

/**
 * Wait for auto-save specifically in saved project keys (not unsaved).
 */
async function waitForSavedAutoSave(page: Page, expectedSubstring: string) {
  const needle = expectedSubstring.toLowerCase();
  await expect(async () => {
    const found = await page.evaluate(({ prefix, search }) => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          const val = localStorage.getItem(key);
          if (val && val.toLowerCase().includes(search)) return true;
        }
      }
      return false;
    }, { prefix: PROJECT_PREFIX, search: needle });
    expect(found).toBe(true);
  }).toPass({ timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Scenario 1: Fresh start -> edit -> auto-save -> refresh (unsaved project)
// ---------------------------------------------------------------------------

test.describe('Scenario 1: Project auto-save and restore', () => {
  test('creates a project, edits a value, reloads, and verifies state restored', async ({ page }) => {
    await resetApp(page);

    // The default project should have loaded with seed data (unsaved)
    await expect(hexInput(page)).toHaveValue('DEADBEEF');

    // Add a second register so we can verify multi-register state persists
    await page.getByRole('button', { name: '+ Add Register' }).click();
    await expect(page.getByRole('heading', { name: 'REG_1' })).toBeVisible();

    // Set a value on REG_1
    await hexInput(page).fill('AABBCCDD');
    await hexInput(page).blur();
    await expect(hexInput(page)).toHaveValue('AABBCCDD');

    // Wait for auto-save to flush to localStorage (unsaved key)
    await waitForAutoSave(page, '0xaabbccdd');

    // Reload page
    await page.reload();

    // The app should restore REG_1 with the value we set
    await expect(page.getByRole('heading', { name: 'REG_1' })).toBeVisible();
    await expect(hexInput(page)).toHaveValue('AABBCCDD');

    // Switch to STATUS_REG and verify it's still there
    await page.locator('aside').getByText('STATUS_REG').click();
    await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
    await expect(hexInput(page)).toHaveValue('DEADBEEF');
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Two projects -> switch -> verify state isolation
// ---------------------------------------------------------------------------

test.describe('Scenario 3: Project state isolation', () => {
  test('two projects maintain separate register values', async ({ page }) => {
    await resetApp(page);

    // Project 1 (the default "Example Project") has STATUS_REG with 0xDEADBEEF
    await expect(hexInput(page)).toHaveValue('DEADBEEF');

    // Save the unsaved project first so it appears in My Projects
    await saveUnsavedProject(page);

    // Wait for auto-save to flush to saved project key
    await waitForSavedAutoSave(page, '0xdeadbeef');

    // Create a second project via menu (no guard — project is now saved)
    await createNewProjectViaMenu(page);

    // Add a register (first register in empty project will be REG_0)
    await page.getByRole('button', { name: '+ Add Register' }).click();
    await expect(page.getByRole('heading', { name: 'REG_0' })).toBeVisible();
    await hexInput(page).fill('11223344');
    await hexInput(page).blur();
    await expect(hexInput(page)).toHaveValue('11223344');

    // Save the second project too so we can switch between them
    await saveUnsavedProject(page);

    // Wait for auto-save to flush
    await waitForSavedAutoSave(page, '0x11223344');

    // Switch back to Project 1 via My Projects dialog
    await openMyProjects(page);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Open project Example Project/ }).click();

    // Should now see STATUS_REG with original value
    await expect(page.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
    await expect(hexInput(page)).toHaveValue('DEADBEEF');

    // Switch back to the untitled project to verify its value is also preserved
    await openMyProjects(page);
    await page.getByRole('dialog').getByRole('button', { name: /Open project Untitled Project/ }).click();

    await expect(page.getByRole('heading', { name: 'REG_0' })).toBeVisible();
    await expect(hexInput(page)).toHaveValue('11223344');
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: Delete local project -> verify removed from manifest & storage
// ---------------------------------------------------------------------------

test.describe('Scenario 7: Delete local project', () => {
  test('deleting a project removes it from manifest and localStorage', async ({ page }) => {
    await resetApp(page);

    // Save the default project first
    await saveUnsavedProject(page);
    await waitForSavedAutoSave(page, 'STATUS_REG');

    // Create a second project via menu (no guard — project is saved)
    await createNewProjectViaMenu(page);
    // New project starts empty; add a register (will be REG_0)
    await page.getByRole('button', { name: '+ Add Register' }).click();
    await expect(page.getByRole('heading', { name: 'REG_0' })).toBeVisible();

    // Save the second project
    await saveUnsavedProject(page);

    // Wait for auto-save to persist the new register
    await waitForSavedAutoSave(page, 'REG_0');

    // Open My Projects
    await openMyProjects(page);
    const dialog = page.getByRole('dialog');

    // Should see 2 projects
    await expect(dialog.getByText('2 projects')).toBeVisible();

    // Delete the "Example Project" (it's not active, so it should have a delete button)
    await dialog.getByRole('button', { name: /Delete project Example Project/ }).click();

    // Confirm inline deletion
    await dialog.getByRole('alertdialog').getByRole('button', { name: /Delete project Example Project/ }).click();

    // Should now show 1 project
    await expect(dialog.getByText('1 project')).toBeVisible();

    // Verify the project data is gone from localStorage
    const storageCheck = await page.evaluate((prefix) => {
      const manifest = JSON.parse(localStorage.getItem('register-viewer-manifest') || '{}');
      const projectKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) projectKeys.push(key);
      }
      return {
        manifestCount: manifest.projects?.length ?? 0,
        projectKeyCount: projectKeys.length,
      };
    }, PROJECT_PREFIX);

    expect(storageCheck.manifestCount).toBe(1);
    expect(storageCheck.projectKeyCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: Multi-tab with different projects -> no conflicts
// ---------------------------------------------------------------------------

test.describe('Scenario 8: Multi-tab project isolation', () => {
  test('two tabs with different projects do not interfere', async ({ context }) => {
    // Tab 1: fresh start
    const page1 = await context.newPage();
    await page1.goto('/');
    await page1.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page1.reload();
    await expect(page1.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();

    // Save the unsaved project first so it gets a localId in the manifest
    await saveUnsavedProject(page1);
    await waitForSavedAutoSave(page1, 'STATUS_REG');

    // Get the seed project's localId from the manifest
    const project1Id = await page1.evaluate(() => {
      const raw = localStorage.getItem('register-viewer-manifest');
      if (!raw) return null;
      const manifest = JSON.parse(raw);
      return manifest.projects?.[0]?.localId ?? null;
    });
    expect(project1Id).toBeTruthy();

    // Create a second project from Tab 1 (no guard — project is saved)
    await createNewProjectViaMenu(page1);
    // New empty project — add a register (REG_0)
    await page1.getByRole('button', { name: '+ Add Register' }).click();
    await expect(page1.getByRole('heading', { name: 'REG_0' })).toBeVisible();

    // Save the second project too
    await saveUnsavedProject(page1);

    // Wait for auto-save to persist the new register
    await waitForSavedAutoSave(page1, 'REG_0');

    // Get the second project's localId
    const project2Id = await page1.evaluate((p1Id) => {
      const raw = localStorage.getItem('register-viewer-manifest');
      if (!raw) return null;
      const manifest = JSON.parse(raw);
      const other = manifest.projects?.find((p: { localId: string }) => p.localId !== p1Id);
      return other?.localId ?? null;
    }, project1Id);
    expect(project2Id).toBeTruthy();
    expect(project2Id).not.toBe(project1Id);

    // Tab 2: open a new tab and set session to project 1
    const page2 = await context.newPage();
    await page2.addInitScript(({ key, id }) => {
      sessionStorage.setItem(key, id);
    }, { key: ACTIVE_PROJECT_SESSION_KEY, id: project1Id! });
    await page2.goto('/');
    await expect(page2.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();

    // Edit in Tab 1 (project 2): change REG_0's value
    await page1.bringToFront();
    await hexInput(page1).fill('FEEDFACE');
    await hexInput(page1).blur();
    await waitForSavedAutoSave(page1, '0xfeedface');

    // Edit in Tab 2 (project 1): change STATUS_REG's value
    await page2.bringToFront();
    await hexInput(page2).fill('CAFEBABE');
    await hexInput(page2).blur();
    await waitForSavedAutoSave(page2, '0xcafebabe');

    // Verify Tab 1 still has its value
    await page1.bringToFront();
    await expect(hexInput(page1)).toHaveValue('FEEDFACE');

    // Verify Tab 2 still has its value
    await page2.bringToFront();
    await expect(hexInput(page2)).toHaveValue('CAFEBABE');

    // Reload both tabs and verify each restores its own project
    // Tab 1 reloads with project 2 session
    await page1.evaluate(({ key, id }) => {
      sessionStorage.setItem(key, id);
    }, { key: ACTIVE_PROJECT_SESSION_KEY, id: project2Id! });
    await page1.reload();
    await expect(page1.getByRole('heading', { name: 'REG_0' })).toBeVisible();
    await expect(hexInput(page1)).toHaveValue('FEEDFACE');

    // Tab 2 reloads with project 1 session
    await page2.evaluate(({ key, id }) => {
      sessionStorage.setItem(key, id);
    }, { key: ACTIVE_PROJECT_SESSION_KEY, id: project1Id! });
    await page2.reload();
    await expect(page2.getByRole('heading', { name: 'STATUS_REG' })).toBeVisible();
    await expect(hexInput(page2)).toHaveValue('CAFEBABE');
  });
});

// ---------------------------------------------------------------------------
// Scenario 9: Legacy migration
// ---------------------------------------------------------------------------

test.describe('Scenario 9: Legacy storage migration', () => {
  test('legacy register-viewer-state is migrated into a new project', async ({ page }) => {
    // Seed legacy data before the app loads (via addInitScript so it's set before React mounts)
    const legacyState = {
      registers: [
        {
          id: 'legacy-reg',
          name: 'LEGACY_REG',
          width: 16,
          fields: [
            { id: 'lf1', name: 'LEGACY_FLAG', msb: 0, lsb: 0, type: 'flag' },
          ],
        },
      ],
      activeRegisterId: 'legacy-reg',
      registerValues: { 'legacy-reg': '0xABCD' },
      project: { title: 'Legacy Project' },
      mapTableWidth: 32,
      mapShowGaps: true,
      mapSortDescending: false,
      addressUnitBits: 8,
    };

    await page.addInitScript((state) => {
      // Clear everything first to simulate a fresh browser
      localStorage.clear();
      sessionStorage.clear();
      // Set only the legacy key
      localStorage.setItem('register-viewer-state', JSON.stringify(state));
    }, legacyState);

    await page.goto('/');

    // The migrated project should load with the legacy register
    await expect(page.getByRole('heading', { name: 'LEGACY_REG' })).toBeVisible();
    await expect(hexInput(page)).toHaveValue('ABCD');

    // Verify the legacy key was cleaned up
    const legacyKeyExists = await page.evaluate(() => {
      return localStorage.getItem('register-viewer-state') !== null;
    });
    expect(legacyKeyExists).toBe(false);

    // Verify the manifest was created with the migrated project
    const manifestCheck = await page.evaluate(() => {
      const raw = localStorage.getItem('register-viewer-manifest');
      if (!raw) return null;
      const manifest = JSON.parse(raw);
      return {
        version: manifest.version,
        projectCount: manifest.projects?.length,
        firstName: manifest.projects?.[0]?.name,
      };
    });

    expect(manifestCheck).not.toBeNull();
    expect(manifestCheck!.version).toBe(1);
    expect(manifestCheck!.projectCount).toBe(1);
    expect(manifestCheck!.firstName).toBe('Legacy Project');

    // Verify the project data was stored with the correct key
    const projectStored = await page.evaluate((prefix) => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          const data = JSON.parse(localStorage.getItem(key)!);
          return {
            name: data.name,
            hasState: !!data.state,
            registerName: data.state?.registers?.[0]?.name,
          };
        }
      }
      return null;
    }, PROJECT_PREFIX);

    expect(projectStored).not.toBeNull();
    expect(projectStored!.name).toBe('Legacy Project');
    expect(projectStored!.hasState).toBe(true);
    expect(projectStored!.registerName).toBe('LEGACY_REG');
  });

  test('legacy data is not re-migrated if manifest already exists', async ({ page }) => {
    // This tests that if a manifest already exists, legacy data is simply cleaned up
    // but not migrated again
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();

      // Set up an existing manifest with a project
      const existingManifest = {
        version: 1,
        projects: [{
          localId: 'existing-id',
          cloudId: null,
          name: 'Existing Project',
          visibility: 'private',
          createdAt: new Date().toISOString(),
          localSavedAt: new Date().toISOString(),
          cloudSavedAt: null,
        }],
      };
      localStorage.setItem('register-viewer-manifest', JSON.stringify(existingManifest));

      // Also store the project data
      const projectData = {
        localId: 'existing-id',
        cloudId: null,
        name: 'Existing Project',
        visibility: 'private',
        createdAt: new Date().toISOString(),
        localSavedAt: new Date().toISOString(),
        cloudSavedAt: null,
        ownerToken: null,
        state: {
          registers: [{
            id: 'existing-reg',
            name: 'EXISTING_REG',
            width: 8,
            fields: [],
          }],
          activeRegisterId: 'existing-reg',
          registerValues: { 'existing-reg': '0xFF' },
          mapTableWidth: 32,
          mapShowGaps: true,
          mapSortDescending: false,
          addressUnitBits: 8,
        },
      };
      localStorage.setItem('register-viewer-project:existing-id', JSON.stringify(projectData));

      // Set legacy data that should NOT be migrated
      const legacyState = {
        registers: [{
          id: 'legacy-reg',
          name: 'SHOULD_NOT_APPEAR',
          width: 8,
          fields: [],
        }],
        activeRegisterId: 'legacy-reg',
        registerValues: { 'legacy-reg': '0x00' },
      };
      localStorage.setItem('register-viewer-state', JSON.stringify(legacyState));
    });

    await page.goto('/');

    // The existing project should load, not the legacy one
    await expect(page.getByRole('heading', { name: 'EXISTING_REG' })).toBeVisible();

    // Verify legacy key was cleaned up
    const legacyGone = await page.evaluate(() =>
      localStorage.getItem('register-viewer-state') === null,
    );
    expect(legacyGone).toBe(true);

    // Verify manifest still has only the existing project (no legacy migration)
    const manifest = await page.evaluate(() => {
      const raw = localStorage.getItem('register-viewer-manifest');
      return raw ? JSON.parse(raw) : null;
    });
    expect(manifest.projects.length).toBe(1);
    expect(manifest.projects[0].name).toBe('Existing Project');
  });
});
