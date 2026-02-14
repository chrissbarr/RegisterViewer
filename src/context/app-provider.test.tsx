import { renderHook } from '@testing-library/react';
import { AppProvider, useAppState, useAppDispatch } from './app-context';
import { makeState, makeRegister } from '../test/helpers';
import type { ReactNode } from 'react';

describe('AppProvider', () => {
  it('provides initial state when no savedState is given', () => {
    function wrapper({ children }: { children: ReactNode }) {
      return <AppProvider>{children}</AppProvider>;
    }
    const { result } = renderHook(() => useAppState(), { wrapper });
    expect(result.current.registers).toEqual([]);
    expect(result.current.activeRegisterId).toBeNull();
    expect(result.current.registerValues).toEqual({});
    expect(result.current.theme).toBe('dark');
  });

  it('provides savedState when passed as prop', () => {
    const saved = makeState({
      theme: 'light',
      registers: [makeRegister({ id: 'reg-1' })],
      registerValues: { 'reg-1': 0xFFn },
      activeRegisterId: 'reg-1',
    });
    function wrapper({ children }: { children: ReactNode }) {
      return <AppProvider savedState={saved}>{children}</AppProvider>;
    }
    const { result } = renderHook(() => useAppState(), { wrapper });
    expect(result.current.theme).toBe('light');
    expect(result.current.registers).toHaveLength(1);
    expect(result.current.registerValues['reg-1']).toBe(0xFFn);
  });

  it('provides a dispatch function', () => {
    function wrapper({ children }: { children: ReactNode }) {
      return <AppProvider>{children}</AppProvider>;
    }
    const { result } = renderHook(() => useAppDispatch(), { wrapper });
    expect(typeof result.current).toBe('function');
  });
});
