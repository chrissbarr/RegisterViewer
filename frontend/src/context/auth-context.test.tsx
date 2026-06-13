import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth, useAuthActions } from './auth-context';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../utils/api-client', () => ({
  isCloudEnabled: vi.fn(() => true),
  sendLoginCode: vi.fn(),
  verifyLoginCode: vi.fn(),
  getAuthMe: vi.fn(),
  postAuthLogout: vi.fn(),
}));

import {
  isCloudEnabled,
  sendLoginCode,
  verifyLoginCode,
  getAuthMe,
  postAuthLogout,
} from '../utils/api-client';

// ── Helpers ──────────────────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

const JWT_KEY = 'register-viewer-jwt';

/** Build a fake JWT with a parseable payload (not cryptographically valid). */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}

/** A valid-looking fake JWT that expires far in the future. */
function validJwt(id: number, email: string): string {
  return fakeJwt({ sub: id, email, exp: Math.floor(Date.now() / 1000) + 86400 });
}

/** A fake JWT that is already expired. */
function expiredJwt(id: number, email: string): string {
  return fakeJwt({ sub: id, email, exp: Math.floor(Date.now() / 1000) - 3600 });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (isCloudEnabled as Mock).mockReturnValue(true);
});

// ── Tests ────────────────────────────────────────────────────────────

describe('AuthProvider', () => {
  describe('initial state', () => {
    it('starts with no user when no JWT stored', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.user).toBeNull();
    });

    it('starts with no user when cloud is disabled', () => {
      (isCloudEnabled as Mock).mockReturnValue(false);
      localStorage.setItem(JWT_KEY, validJwt(1, 'a@b.com'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.user).toBeNull();
    });

    it('initializes user immediately from valid JWT payload', () => {
      const jwt = validJwt(1, 'a@b.com');
      localStorage.setItem(JWT_KEY, jwt);
      (getAuthMe as Mock).mockResolvedValue({ user: { id: 1, email: 'a@b.com' } });

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.user).toEqual({ id: 1, email: 'a@b.com' });
    });

    it('starts with no user when stored JWT is expired', () => {
      localStorage.setItem(JWT_KEY, expiredJwt(1, 'a@b.com'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.user).toBeNull();
    });

    it('starts with no user when stored JWT is malformed', () => {
      localStorage.setItem(JWT_KEY, 'not-a-jwt');

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.user).toBeNull();
    });

    it('treats JWT without exp field as non-expired', () => {
      const jwt = fakeJwt({ sub: 5, email: 'noexp@test.com' });
      localStorage.setItem(JWT_KEY, jwt);
      (getAuthMe as Mock).mockResolvedValue({ user: { id: 5, email: 'noexp@test.com' } });

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.user).toEqual({ id: 5, email: 'noexp@test.com' });
    });
  });

  describe('JWT validation on mount', () => {
    it('validates stored JWT and updates user from server', async () => {
      const jwt = validJwt(42, 'user@example.com');
      localStorage.setItem(JWT_KEY, jwt);
      (getAuthMe as Mock).mockResolvedValue({ user: { id: 42, email: 'user@example.com' } });

      const { result } = await renderHookAndFlush(() => useAuth());

      expect(getAuthMe).toHaveBeenCalledWith(jwt);
      expect(result.current.user).toEqual({ id: 42, email: 'user@example.com' });
    });

    it('clears user and JWT when server rejects token', async () => {
      const jwt = validJwt(42, 'user@example.com');
      localStorage.setItem(JWT_KEY, jwt);
      (getAuthMe as Mock).mockRejectedValue(new Error('401'));

      const { result } = await renderHookAndFlush(() => useAuth());

      expect(result.current.user).toBeNull();
      expect(localStorage.getItem(JWT_KEY)).toBeNull();
    });

    it('stores refreshed token when returned by getAuthMe', async () => {
      const jwt = validJwt(42, 'user@example.com');
      localStorage.setItem(JWT_KEY, jwt);
      (getAuthMe as Mock).mockResolvedValue({
        user: { id: 42, email: 'user@example.com' },
        refreshedToken: 'new-refreshed-jwt',
      });

      await renderHookAndFlush(() => useAuth());

      expect(localStorage.getItem(JWT_KEY)).toBe('new-refreshed-jwt');
    });

    it('keeps existing JWT when no refreshedToken returned', async () => {
      const jwt = validJwt(42, 'user@example.com');
      localStorage.setItem(JWT_KEY, jwt);
      (getAuthMe as Mock).mockResolvedValue({
        user: { id: 42, email: 'user@example.com' },
      });

      await renderHookAndFlush(() => useAuth());

      expect(localStorage.getItem(JWT_KEY)).toBe(jwt);
    });

    it('does not call getAuthMe when no JWT stored', () => {
      renderHook(() => useAuth(), { wrapper });

      expect(getAuthMe).not.toHaveBeenCalled();
    });

    it('does not call getAuthMe when cloud is disabled', () => {
      (isCloudEnabled as Mock).mockReturnValue(false);
      localStorage.setItem(JWT_KEY, validJwt(1, 'a@b.com'));

      renderHook(() => useAuth(), { wrapper });

      expect(getAuthMe).not.toHaveBeenCalled();
    });
  });

  describe('sendCode', () => {
    it('calls API sendLoginCode', async () => {
      (sendLoginCode as Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useAuthActions(), { wrapper });

      await act(async () => {
        await result.current.sendCode('user@example.com');
      });

      expect(sendLoginCode).toHaveBeenCalledWith('user@example.com');
    });

    it('propagates API errors', async () => {
      (sendLoginCode as Mock).mockRejectedValue(new Error('rate limited'));

      const { result } = renderHook(() => useAuthActions(), { wrapper });

      await expect(
        act(async () => {
          await result.current.sendCode('user@example.com');
        }),
      ).rejects.toThrow('rate limited');
    });
  });

  describe('verifyCode', () => {
    it('stores JWT and sets user on success', async () => {
      (verifyLoginCode as Mock).mockResolvedValue({
        token: 'new-jwt-token',
        user: { id: 7, email: 'test@test.com' },
      });

      // Use a shared wrapper to get both hooks from same provider
      const { result } = renderHook(
        () => ({ state: useAuth(), actions: useAuthActions() }),
        { wrapper },
      );

      await act(async () => {
        await result.current.actions.verifyCode('test@test.com', '123456');
      });

      expect(verifyLoginCode).toHaveBeenCalledWith('test@test.com', '123456');
      expect(localStorage.getItem(JWT_KEY)).toBe('new-jwt-token');
      expect(result.current.state.user).toEqual({ id: 7, email: 'test@test.com' });
    });

    it('propagates API errors without setting user', async () => {
      (verifyLoginCode as Mock).mockRejectedValue(new Error('invalid code'));

      const { result } = renderHook(
        () => ({ state: useAuth(), actions: useAuthActions() }),
        { wrapper },
      );

      await expect(
        act(async () => {
          await result.current.actions.verifyCode('test@test.com', '000000');
        }),
      ).rejects.toThrow('invalid code');

      expect(result.current.state.user).toBeNull();
      expect(localStorage.getItem(JWT_KEY)).toBeNull();
    });
  });

  describe('registerPreLogout', () => {
    it('runs the registered pre-logout callback before clearing the JWT', async () => {
      (postAuthLogout as Mock).mockResolvedValue(undefined);
      const seededJwt = validJwt(1, 'a@b.com');
      localStorage.setItem(JWT_KEY, seededJwt);
      let jwtDuringFlush: string | null = null;

      const { result } = renderHook(() => useAuthActions(), { wrapper });
      act(() => {
        result.current.registerPreLogout(async () => {
          jwtDuringFlush = localStorage.getItem(JWT_KEY);
        });
      });

      await act(async () => { await result.current.logout(); });

      // Must be the exact seeded JWT — null or 'not-run' both mean the hook never fired.
      expect(jwtDuringFlush).toBe(seededJwt);
      expect(localStorage.getItem(JWT_KEY)).toBeNull(); // cleared afterward
    });

    it('clears the JWT even when the pre-logout callback times out', async () => {
      vi.useFakeTimers();
      (postAuthLogout as Mock).mockResolvedValue(undefined);
      const seededJwt = validJwt(1, 'a@b.com');
      localStorage.setItem(JWT_KEY, seededJwt);

      const { result } = renderHook(() => useAuthActions(), { wrapper });
      act(() => {
        // Hook that never resolves — simulates a hung flush
        result.current.registerPreLogout(() => new Promise<void>(() => {}));
      });

      // Start logout — it should be waiting on the race
      let logoutDone = false;
      act(() => {
        result.current.logout().then(() => { logoutDone = true; });
      });

      // Before the timeout fires, JWT should still be present
      expect(localStorage.getItem(JWT_KEY)).toBe(seededJwt);

      // Advance past PRE_LOGOUT_TIMEOUT_MS (4000 ms)
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(logoutDone).toBe(true);
      expect(localStorage.getItem(JWT_KEY)).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('logout', () => {
    it('clears JWT and user', async () => {
      (postAuthLogout as Mock).mockResolvedValue(undefined);
      // First sign in
      (verifyLoginCode as Mock).mockResolvedValue({
        token: 'jwt-to-clear',
        user: { id: 1, email: 'a@b.com' },
      });

      const { result } = renderHook(
        () => ({ state: useAuth(), actions: useAuthActions() }),
        { wrapper },
      );

      await act(async () => {
        await result.current.actions.verifyCode('a@b.com', '123456');
      });

      expect(result.current.state.user).not.toBeNull();
      expect(localStorage.getItem(JWT_KEY)).toBe('jwt-to-clear');

      await act(async () => {
        await result.current.actions.logout();
      });

      expect(result.current.state.user).toBeNull();
      expect(localStorage.getItem(JWT_KEY)).toBeNull();
    });

    it('calls server-side logout with JWT', async () => {
      (postAuthLogout as Mock).mockResolvedValue(undefined);
      (verifyLoginCode as Mock).mockResolvedValue({
        token: 'jwt-to-revoke',
        user: { id: 1, email: 'a@b.com' },
      });

      const { result } = renderHook(
        () => ({ state: useAuth(), actions: useAuthActions() }),
        { wrapper },
      );

      await act(async () => {
        await result.current.actions.verifyCode('a@b.com', '123456');
      });

      await act(async () => {
        await result.current.actions.logout();
      });

      expect(postAuthLogout).toHaveBeenCalledWith('jwt-to-revoke');
    });

    it('does not call server-side logout when cloud disabled', async () => {
      (postAuthLogout as Mock).mockResolvedValue(undefined);
      (isCloudEnabled as Mock).mockReturnValue(false);
      localStorage.setItem(JWT_KEY, 'some-jwt');

      const { result } = renderHook(
        () => ({ state: useAuth(), actions: useAuthActions() }),
        { wrapper },
      );

      await act(async () => {
        await result.current.actions.logout();
      });

      expect(postAuthLogout).not.toHaveBeenCalled();
    });

    it('still clears local state when server-side logout fails', async () => {
      (postAuthLogout as Mock).mockRejectedValue(new Error('network error'));
      (verifyLoginCode as Mock).mockResolvedValue({
        token: 'jwt-to-fail',
        user: { id: 1, email: 'a@b.com' },
      });

      const { result } = renderHook(
        () => ({ state: useAuth(), actions: useAuthActions() }),
        { wrapper },
      );

      await act(async () => {
        await result.current.actions.verifyCode('a@b.com', '123456');
      });

      await act(async () => {
        await result.current.actions.logout();
      });

      // Local state should be cleared even though server call fails
      expect(result.current.state.user).toBeNull();
      expect(localStorage.getItem(JWT_KEY)).toBeNull();
    });
  });

  describe('getJwt', () => {
    it('returns null when no JWT stored', () => {
      const { result } = renderHook(() => useAuthActions(), { wrapper });

      expect(result.current.getJwt()).toBeNull();
    });

    it('returns stored JWT', () => {
      localStorage.setItem(JWT_KEY, 'my-jwt');

      const { result } = renderHook(() => useAuthActions(), { wrapper });

      expect(result.current.getJwt()).toBe('my-jwt');
    });
  });

  describe('context errors', () => {
    it('useAuth throws outside AuthProvider', () => {
      expect(() => {
        renderHook(() => useAuth());
      }).toThrow('useAuth must be used within AuthProvider');
    });

    it('useAuthActions throws outside AuthProvider', () => {
      expect(() => {
        renderHook(() => useAuthActions());
      }).toThrow('useAuthActions must be used within AuthProvider');
    });
  });
});

// ── Helper: render hook and flush the async mount effect ─────────────

async function renderHookAndFlush<T>(hook: () => T) {
  let hookResult: ReturnType<typeof renderHook<T, unknown>>;
  await act(async () => {
    hookResult = renderHook(hook, { wrapper });
  });
  return hookResult!;
}
