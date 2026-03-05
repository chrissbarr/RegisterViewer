import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useLoginGuard } from './use-login-guard';

// ── Helpers ──────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<Parameters<typeof useLoginGuard>[0]> = {}) {
  return {
    getJwt: vi.fn(() => 'mock-jwt'),
    rawSave: vi.fn(() => Promise.resolve(true)),
    rawFork: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('useLoginGuard', () => {
  it('delegates saveToCloud when JWT is present', async () => {
    const rawSave = vi.fn(() => Promise.resolve(true));
    const { result } = renderHook(() => useLoginGuard(makeDeps({ rawSave })));

    let returnVal: boolean | undefined;
    await act(async () => {
      returnVal = await result.current.saveToCloud();
    });

    expect(rawSave).toHaveBeenCalledTimes(1);
    expect(returnVal).toBe(true);
    expect(result.current.loginRequired).toBe(false);
  });

  it('sets loginRequired when no JWT for save', async () => {
    const rawSave = vi.fn(() => Promise.resolve(true));
    const { result } = renderHook(() =>
      useLoginGuard(makeDeps({ getJwt: vi.fn(() => null), rawSave })),
    );

    await act(async () => {
      await result.current.saveToCloud();
    });

    expect(rawSave).not.toHaveBeenCalled();
    expect(result.current.loginRequired).toBe(true);
    expect(result.current.pendingCloudOpRef.current).toBe('save');
  });

  it('delegates fork when JWT is present', async () => {
    const rawFork = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useLoginGuard(makeDeps({ rawFork })));

    await act(async () => {
      await result.current.fork();
    });

    expect(rawFork).toHaveBeenCalledTimes(1);
    expect(result.current.loginRequired).toBe(false);
  });

  it('sets loginRequired when no JWT for fork', async () => {
    const rawFork = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() =>
      useLoginGuard(makeDeps({ getJwt: vi.fn(() => null), rawFork })),
    );

    await act(async () => {
      await result.current.fork();
    });

    expect(rawFork).not.toHaveBeenCalled();
    expect(result.current.loginRequired).toBe(true);
    expect(result.current.pendingCloudOpRef.current).toBe('fork');
  });

  it('cancelPendingOp clears loginRequired and pendingOp', async () => {
    const { result } = renderHook(() =>
      useLoginGuard(makeDeps({ getJwt: vi.fn(() => null) })),
    );

    // Trigger login required
    await act(async () => {
      await result.current.saveToCloud();
    });
    expect(result.current.loginRequired).toBe(true);

    // Cancel
    act(() => {
      result.current.cancelPendingOp();
    });

    expect(result.current.loginRequired).toBe(false);
    expect(result.current.pendingCloudOpRef.current).toBe(null);
  });
});
