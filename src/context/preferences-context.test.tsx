import { renderHook, act } from '@testing-library/react';
import { PreferencesProvider, usePreferences, usePreferencesActions } from './preferences-context';
import type { ReactNode } from 'react';

vi.mock('../utils/global-preferences', () => ({
  loadPreferences: vi.fn(() => ({
    theme: 'light' as const,
    sidebarWidth: 224,
    sidebarCollapsed: false,
  })),
  savePreferences: vi.fn(),
}));

import { loadPreferences, savePreferences } from '../utils/global-preferences';

const mockLoadPreferences = vi.mocked(loadPreferences);
const mockSavePreferences = vi.mocked(savePreferences);

function wrapper({ children }: { children: ReactNode }) {
  return <PreferencesProvider>{children}</PreferencesProvider>;
}

function renderState() {
  return renderHook(() => usePreferences(), { wrapper });
}

function renderBoth() {
  return renderHook(
    () => ({ state: usePreferences(), actions: usePreferencesActions() }),
    { wrapper },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.classList.remove('dark');
  mockLoadPreferences.mockReturnValue({
    theme: 'light',
    sidebarWidth: 224,
    sidebarCollapsed: false,
  });
});

// ---------------------------------------------------------------------------
// Hooks throw outside provider
// ---------------------------------------------------------------------------
describe('hooks outside provider', () => {
  it('usePreferences throws when used outside PreferencesProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => usePreferences())).toThrow(
      'usePreferences must be used within PreferencesProvider',
    );
    spy.mockRestore();
  });

  it('usePreferencesActions throws when used outside PreferencesProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => usePreferencesActions())).toThrow(
      'usePreferencesActions must be used within PreferencesProvider',
    );
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------
describe('initial state', () => {
  it('loads state from loadPreferences()', () => {
    mockLoadPreferences.mockReturnValue({
      theme: 'dark',
      sidebarWidth: 300,
      sidebarCollapsed: true,
    });

    const { result } = renderState();

    expect(loadPreferences).toHaveBeenCalledOnce();
    expect(result.current.theme).toBe('dark');
    expect(result.current.sidebarWidth).toBe(300);
    expect(result.current.sidebarCollapsed).toBe(true);
  });

  it('uses default values from loadPreferences when localStorage is empty', () => {
    const { result } = renderState();

    expect(result.current.theme).toBe('light');
    expect(result.current.sidebarWidth).toBe(224);
    expect(result.current.sidebarCollapsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setTheme / toggleTheme
// ---------------------------------------------------------------------------
describe('setTheme', () => {
  it('updates theme to dark', () => {
    const { result } = renderBoth();

    act(() => result.current.actions.setTheme('dark'));

    expect(result.current.state.theme).toBe('dark');
  });

  it('updates theme to light', () => {
    mockLoadPreferences.mockReturnValue({
      theme: 'dark',
      sidebarWidth: 224,
      sidebarCollapsed: false,
    });
    const { result } = renderBoth();

    act(() => result.current.actions.setTheme('light'));

    expect(result.current.state.theme).toBe('light');
  });
});

describe('toggleTheme', () => {
  it('toggles from light to dark', () => {
    const { result } = renderBoth();

    act(() => result.current.actions.toggleTheme());

    expect(result.current.state.theme).toBe('dark');
  });

  it('toggles from dark to light', () => {
    mockLoadPreferences.mockReturnValue({
      theme: 'dark',
      sidebarWidth: 224,
      sidebarCollapsed: false,
    });
    const { result } = renderBoth();

    act(() => result.current.actions.toggleTheme());

    expect(result.current.state.theme).toBe('light');
  });

  it('double toggle returns to original theme', () => {
    const { result } = renderBoth();

    act(() => result.current.actions.toggleTheme());
    act(() => result.current.actions.toggleTheme());

    expect(result.current.state.theme).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// setSidebarWidth clamping
// ---------------------------------------------------------------------------
describe('setSidebarWidth', () => {
  it('sets width within valid range', () => {
    const { result } = renderBoth();

    act(() => result.current.actions.setSidebarWidth(300));

    expect(result.current.state.sidebarWidth).toBe(300);
  });

  it('clamps width below SIDEBAR_WIDTH_MIN (180) to minimum', () => {
    const { result } = renderBoth();

    act(() => result.current.actions.setSidebarWidth(50));

    expect(result.current.state.sidebarWidth).toBe(180);
  });

  it('clamps width above SIDEBAR_WIDTH_MAX (400) to maximum', () => {
    const { result } = renderBoth();

    act(() => result.current.actions.setSidebarWidth(999));

    expect(result.current.state.sidebarWidth).toBe(400);
  });

  it('accepts exact minimum value', () => {
    const { result } = renderBoth();

    act(() => result.current.actions.setSidebarWidth(180));

    expect(result.current.state.sidebarWidth).toBe(180);
  });

  it('accepts exact maximum value', () => {
    const { result } = renderBoth();

    act(() => result.current.actions.setSidebarWidth(400));

    expect(result.current.state.sidebarWidth).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// setSidebarCollapsed
// ---------------------------------------------------------------------------
describe('setSidebarCollapsed', () => {
  it('sets collapsed to true', () => {
    const { result } = renderBoth();

    act(() => result.current.actions.setSidebarCollapsed(true));

    expect(result.current.state.sidebarCollapsed).toBe(true);
  });

  it('sets collapsed to false', () => {
    mockLoadPreferences.mockReturnValue({
      theme: 'light',
      sidebarWidth: 224,
      sidebarCollapsed: true,
    });
    const { result } = renderBoth();

    act(() => result.current.actions.setSidebarCollapsed(false));

    expect(result.current.state.sidebarCollapsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Theme class toggling on <html>
// ---------------------------------------------------------------------------
describe('theme class on document.documentElement', () => {
  it('adds dark class when theme is dark', () => {
    mockLoadPreferences.mockReturnValue({
      theme: 'dark',
      sidebarWidth: 224,
      sidebarCollapsed: false,
    });

    renderState();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does not add dark class when theme is light', () => {
    renderState();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('adds dark class when theme changes from light to dark', () => {
    const { result } = renderBoth();
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => result.current.actions.setTheme('dark'));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes dark class when theme changes from dark to light', () => {
    mockLoadPreferences.mockReturnValue({
      theme: 'dark',
      sidebarWidth: 224,
      sidebarCollapsed: false,
    });
    const { result } = renderBoth();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => result.current.actions.setTheme('light'));

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Debounced saving
// ---------------------------------------------------------------------------
describe('debounced saving to localStorage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call savePreferences immediately on state change', () => {
    const { result } = renderBoth();
    mockSavePreferences.mockClear();

    act(() => result.current.actions.setTheme('dark'));

    // The initial render may have triggered a save schedule too,
    // but the important thing is the latest change hasn't flushed yet
    const callCountBeforeTimer = mockSavePreferences.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(299);
    });

    expect(mockSavePreferences.mock.calls.length).toBe(callCountBeforeTimer);
  });

  it('calls savePreferences after 300ms debounce', () => {
    const { result } = renderBoth();
    mockSavePreferences.mockClear();

    act(() => result.current.actions.setTheme('dark'));

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mockSavePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'dark' }),
    );
  });

  it('debounces multiple rapid changes into a single save', () => {
    const { result } = renderBoth();
    mockSavePreferences.mockClear();

    act(() => result.current.actions.setSidebarWidth(250));
    act(() => result.current.actions.setSidebarWidth(280));
    act(() => result.current.actions.setSidebarWidth(320));

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Only the final value should be saved - each setState restarts the timer
    const lastCall = mockSavePreferences.mock.calls[mockSavePreferences.mock.calls.length - 1];
    expect(lastCall[0]).toEqual(expect.objectContaining({ sidebarWidth: 320 }));
  });
});

// ---------------------------------------------------------------------------
// Flush on beforeunload
// ---------------------------------------------------------------------------
describe('flush on beforeunload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires pending save immediately on beforeunload', () => {
    const { result } = renderBoth();
    mockSavePreferences.mockClear();

    act(() => result.current.actions.setTheme('dark'));

    // Fire beforeunload before the debounce timer completes
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    expect(mockSavePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'dark' }),
    );
  });

  it('fires pending save immediately on pagehide', () => {
    const { result } = renderBoth();
    mockSavePreferences.mockClear();

    act(() => result.current.actions.setSidebarCollapsed(true));

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(mockSavePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ sidebarCollapsed: true }),
    );
  });

  it('does not double-save if beforeunload fires after debounce already completed', () => {
    const { result } = renderBoth();
    mockSavePreferences.mockClear();

    act(() => result.current.actions.setTheme('dark'));

    // Let debounce complete
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const callCountAfterDebounce = mockSavePreferences.mock.calls.length;

    // Fire beforeunload - should not trigger another save
    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    expect(mockSavePreferences.mock.calls.length).toBe(callCountAfterDebounce);
  });
});

// ---------------------------------------------------------------------------
// Cleanup on unmount flushes pending saves
// ---------------------------------------------------------------------------
describe('cleanup on unmount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes pending save when provider unmounts', () => {
    const { result, unmount } = renderBoth();
    mockSavePreferences.mockClear();

    act(() => result.current.actions.setSidebarWidth(350));

    // Unmount before debounce fires
    unmount();

    expect(mockSavePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ sidebarWidth: 350 }),
    );
  });
});
