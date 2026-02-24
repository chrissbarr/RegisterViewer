import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { loadPreferences, savePreferences } from '../utils/global-preferences';
import { SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX } from '../types/register';
import { SAVE_DEBOUNCE_MS } from '../constants';

interface PreferencesState {
  theme: 'light' | 'dark';
  sidebarWidth: number;
  sidebarCollapsed: boolean;
}

interface PreferencesActions {
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const PreferencesStateContext = createContext<PreferencesState | null>(null);
const PreferencesActionsContext = createContext<PreferencesActions | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<PreferencesState>(() => {
    const loaded = loadPreferences();
    return {
      theme: loaded.theme,
      sidebarWidth: loaded.sidebarWidth,
      sidebarCollapsed: loaded.sidebarCollapsed,
    };
  });

  // Debounced save to localStorage
  const pendingPrefsRef = useRef<PreferencesState | null>(null);

  useEffect(() => {
    pendingPrefsRef.current = prefs;
    const timer = setTimeout(() => {
      savePreferences(prefs);
      pendingPrefsRef.current = null;
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [prefs]);

  // Flush pending save on page unload
  useEffect(() => {
    const flush = () => {
      if (pendingPrefsRef.current !== null) {
        savePreferences(pendingPrefsRef.current);
        pendingPrefsRef.current = null;
      }
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  // Sync theme class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', prefs.theme === 'dark');
  }, [prefs.theme]);

  const setTheme = useCallback((theme: 'light' | 'dark') => {
    setPrefs((prev) => ({ ...prev, theme }));
  }, []);

  const toggleTheme = useCallback(() => {
    setPrefs((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }));
  }, []);

  const setSidebarWidth = useCallback((width: number) => {
    const clamped = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, width));
    setPrefs((prev) => ({ ...prev, sidebarWidth: clamped }));
  }, []);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setPrefs((prev) => ({ ...prev, sidebarCollapsed: collapsed }));
  }, []);

  const actions = useMemo<PreferencesActions>(
    () => ({ setTheme, toggleTheme, setSidebarWidth, setSidebarCollapsed }),
    [setTheme, toggleTheme, setSidebarWidth, setSidebarCollapsed],
  );

  return (
    <PreferencesStateContext.Provider value={prefs}>
      <PreferencesActionsContext.Provider value={actions}>
        {children}
      </PreferencesActionsContext.Provider>
    </PreferencesStateContext.Provider>
  );
}

export function usePreferences(): PreferencesState {
  const ctx = useContext(PreferencesStateContext);
  if (!ctx) throw new Error('usePreferences must be used within PreferencesProvider');
  return ctx;
}

export function usePreferencesActions(): PreferencesActions {
  const ctx = useContext(PreferencesActionsContext);
  if (!ctx) throw new Error('usePreferencesActions must be used within PreferencesProvider');
  return ctx;
}
