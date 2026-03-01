import { test, expect, type Page, type Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Mock JWT helper
// ---------------------------------------------------------------------------

/**
 * Build a fake JWT string whose payload passes the client-side
 * `parseJwtPayload` check (needs `sub`, `email`, `exp` with 3-part
 * dot-separated base64url structure).  The signature is bogus but
 * the frontend never verifies it.
 */
function makeMockJwt(email: string, userId = 42): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400, // 24 h
    jti: 'mock-jti-001',
  };
  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode(header)}.${encode(payload)}.mock-signature`;
}

const MOCK_EMAIL = 'test@example.com';
const MOCK_JWT = makeMockJwt(MOCK_EMAIL);

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

/** Open the application menu and click "Sign in". */
async function openLoginDialog(page: Page) {
  await page.getByRole('button', { name: 'Application menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign in' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** Complete the full login flow (open dialog, send code, verify code). */
async function performLogin(page: Page) {
  await openLoginDialog(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email address').fill(MOCK_EMAIL);
  await dialog.getByRole('button', { name: 'Send code' }).click();
  await expect(dialog.getByLabel('Verification code')).toBeVisible({ timeout: 5000 });
  await dialog.getByLabel('Verification code').fill('123456');
  await dialog.getByRole('button', { name: 'Verify' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });
}

/**
 * Set up route interception for all auth API calls.
 * Must be called BEFORE navigating or triggering auth operations.
 */
async function mockAuthApi(page: Page, options: {
  /** Override for POST /api/auth/send-code. Default: 200. */
  sendCodeResponse?: { status: number; body?: unknown };
  /** Override for POST /api/auth/verify-code. */
  verifyCodeResponse?: { status: number; body: unknown };
  /** Override for GET /api/auth/me. */
  meResponse?: { status: number; body: unknown };
  /** Override for POST /api/auth/logout. Default: 204. */
  logoutStatus?: number;
  /** Callback invoked on every intercepted request. */
  onRequest?: (method: string, url: string, body: unknown) => void;
} = {}) {
  await page.route(/\/api\/auth\//, async (route: Route) => {
    const method = route.request().method();
    const url = route.request().url();
    const path = new URL(url).pathname;

    let body: unknown = null;
    try { body = route.request().postDataJSON(); } catch { /* no body */ }
    options.onRequest?.(method, url, body);

    // POST /api/auth/send-code
    if (path.endsWith('/auth/send-code') && method === 'POST') {
      const resp = options.sendCodeResponse ?? { status: 200, body: {} };
      await route.fulfill({
        status: resp.status,
        contentType: 'application/json',
        body: JSON.stringify(resp.body ?? {}),
      });
      return;
    }

    // POST /api/auth/verify-code
    if (path.endsWith('/auth/verify-code') && method === 'POST') {
      const resp = options.verifyCodeResponse ?? {
        status: 200,
        body: { token: MOCK_JWT, user: { id: 42, email: MOCK_EMAIL } },
      };
      await route.fulfill({
        status: resp.status,
        contentType: 'application/json',
        body: JSON.stringify(resp.body),
      });
      return;
    }

    // GET /api/auth/me
    if (path.endsWith('/auth/me') && method === 'GET') {
      const resp = options.meResponse ?? {
        status: 200,
        body: { user: { id: 42, email: MOCK_EMAIL } },
      };
      await route.fulfill({
        status: resp.status,
        contentType: 'application/json',
        body: JSON.stringify(resp.body),
      });
      return;
    }

    // POST /api/auth/logout
    if (path.endsWith('/auth/logout') && method === 'POST') {
      const status = options.logoutStatus ?? 204;
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: '',
      });
      return;
    }

    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Auth: Login dialog opens from menu', () => {
  test('clicking "Sign in" opens the login dialog', async ({ page }) => {
    await mockAuthApi(page);
    await resetApp(page);

    await openLoginDialog(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Sign In' })).toBeVisible();
    await expect(dialog.getByText('Enter your email to receive a sign-in code')).toBeVisible();
    await expect(dialog.getByLabel('Email address')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Send code' })).toBeVisible();
  });
});

test.describe('Auth: Email step transitions to code step', () => {
  test('entering a valid email and submitting shows the code input', async ({ page }) => {
    await mockAuthApi(page);
    await resetApp(page);
    await openLoginDialog(page);

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email address').fill(MOCK_EMAIL);
    await dialog.getByRole('button', { name: 'Send code' }).click();

    // Should transition to code step
    await expect(dialog.getByText(`We sent a 6-digit code to`)).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText(MOCK_EMAIL)).toBeVisible();
    await expect(dialog.getByLabel('Verification code')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Verify' })).toBeVisible();
  });
});

test.describe('Auth: Invalid code shows error', () => {
  test('entering an invalid code shows an error message', async ({ page }) => {
    await mockAuthApi(page, {
      verifyCodeResponse: {
        status: 401,
        body: { error: 'Invalid or expired code' },
      },
    });
    await resetApp(page);
    await openLoginDialog(page);

    const dialog = page.getByRole('dialog');

    // Go to code step
    await dialog.getByLabel('Email address').fill(MOCK_EMAIL);
    await dialog.getByRole('button', { name: 'Send code' }).click();
    await expect(dialog.getByLabel('Verification code')).toBeVisible({ timeout: 5000 });

    // Enter code and submit
    await dialog.getByLabel('Verification code').fill('999999');
    await dialog.getByRole('button', { name: 'Verify' }).click();

    // Should show error
    await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText('Invalid or expired code. Please try again.')).toBeVisible();
  });
});

test.describe('Auth: Successful login updates menu', () => {
  test('after verifying code, menu shows signed-in state', async ({ page }) => {
    await mockAuthApi(page);
    await resetApp(page);
    await performLogin(page);

    // Open menu — footer should show email + Sign out, "Sign in" item should be gone
    await page.getByRole('button', { name: 'Application menu' }).click();
    await expect(page.getByText(MOCK_EMAIL)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Sign in' })).not.toBeVisible();
  });
});

test.describe('Auth: Logout reverts UI', () => {
  test('signing out reverts menu to show "Sign in"', async ({ page }) => {
    await mockAuthApi(page);
    await resetApp(page);
    await performLogin(page);

    // Open menu and click Sign out in footer
    await page.getByRole('button', { name: 'Application menu' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();

    // Re-open menu — should revert to "Sign in" item, no footer email
    await page.getByRole('button', { name: 'Application menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText(MOCK_EMAIL)).not.toBeVisible();
  });
});

test.describe('Auth: Rate limit error on send-code', () => {
  test('429 response shows rate limit error in dialog', async ({ page }) => {
    await mockAuthApi(page, {
      sendCodeResponse: { status: 429, body: { error: 'Too many requests' } },
    });
    await resetApp(page);
    await openLoginDialog(page);

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email address').fill(MOCK_EMAIL);
    await dialog.getByRole('button', { name: 'Send code' }).click();

    // Should show rate limit error
    await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText('Too many attempts. Please wait a few minutes.')).toBeVisible();

    // Should stay on email step (not transition to code step)
    await expect(dialog.getByLabel('Email address')).toBeVisible();
  });
});
