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

vi.mock('../utils/owner-token', () => ({
  getOrCreateOwnerToken: vi.fn(() => 'mock-owner-token'),
  hashOwnerToken: vi.fn(async () => 'mock-token-hash'),
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (isCloudEnabled as Mock).mockReturnValue(true);
});

// ── Tests ────────────────────────────────────────────────────────────

describe('AuthProvider', () => {
  describe('initial state', () => {
    it('starts with no user and not loading when no JWT stored', () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.user).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it('starts with no user and not loading when cloud is disabled', () => {
      (isCloudEnabled as Mock).mockReturnValue(false);
      localStorage.setItem(JWT_KEY, 'some-jwt');

      const { result } = renderHook(() => useAuth(), { wrapper });

      expect(result.current.user).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it('starts loading when JWT exists and cloud enabled', () => {
      localStorage.setItem(JWT_KEY, 'stored-jwt');
      (getAuthMe as Mock).mockResolvedValue({ user: { id: 1, email: 'a@b.com' } });

      const { result } = renderHook(() => useAuth(), { wrapper });

      // isLoading is true synchronously before the effect resolves
      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('JWT validation on mount', () => {
    it('validates stored JWT and sets user on success', async () => {
      localStorage.setItem(JWT_KEY, 'valid-jwt');
      (getAuthMe as Mock).mockResolvedValue({ user: { id: 42, email: 'user@example.com' } });

      const { result } = await renderHookAndFlush(() => useAuth());

      expect(getAuthMe).toHaveBeenCalledWith('valid-jwt');
      expect(result.current.user).toEqual({ id: 42, email: 'user@example.com' });
      expect(result.current.isLoading).toBe(false);
    });

    it('clears JWT on validation failure', async () => {
      localStorage.setItem(JWT_KEY, 'expired-jwt');
      (getAuthMe as Mock).mockRejectedValue(new Error('401'));

      const { result } = await renderHookAndFlush(() => useAuth());

      expect(result.current.user).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(localStorage.getItem(JWT_KEY)).toBeNull();
    });

    it('stores refreshed token when returned by getAuthMe', async () => {
      localStorage.setItem(JWT_KEY, 'old-jwt');
      (getAuthMe as Mock).mockResolvedValue({
        user: { id: 42, email: 'user@example.com' },
        refreshedToken: 'new-refreshed-jwt',
      });

      await renderHookAndFlush(() => useAuth());

      expect(localStorage.getItem(JWT_KEY)).toBe('new-refreshed-jwt');
    });

    it('keeps existing JWT when no refreshedToken returned', async () => {
      localStorage.setItem(JWT_KEY, 'current-jwt');
      (getAuthMe as Mock).mockResolvedValue({
        user: { id: 42, email: 'user@example.com' },
      });

      await renderHookAndFlush(() => useAuth());

      expect(localStorage.getItem(JWT_KEY)).toBe('current-jwt');
    });

    it('does not call getAuthMe when no JWT stored', () => {
      renderHook(() => useAuth(), { wrapper });

      expect(getAuthMe).not.toHaveBeenCalled();
    });

    it('does not call getAuthMe when cloud is disabled', () => {
      (isCloudEnabled as Mock).mockReturnValue(false);
      localStorage.setItem(JWT_KEY, 'some-jwt');

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

      expect(verifyLoginCode).toHaveBeenCalledWith('test@test.com', '123456', 'mock-owner-token');
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

      act(() => {
        result.current.actions.logout();
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

      act(() => {
        result.current.actions.logout();
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

      act(() => {
        result.current.actions.logout();
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

      act(() => {
        result.current.actions.logout();
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
