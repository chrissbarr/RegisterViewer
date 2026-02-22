import type { GlobalPreferences } from '../types/project';
import { SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_DEFAULT } from '../types/register';

const PREFS_KEY = 'register-viewer-prefs';

const DEFAULT_PREFERENCES: GlobalPreferences = {
  theme: 'light',
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  sidebarCollapsed: false,
};

export function loadPreferences(): GlobalPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw);
    return {
      theme: parsed.theme === 'dark' ? 'dark' : 'light',
      sidebarWidth: typeof parsed.sidebarWidth === 'number'
        ? Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, parsed.sidebarWidth))
        : SIDEBAR_WIDTH_DEFAULT,
      sidebarCollapsed: parsed.sidebarCollapsed === true,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(prefs: GlobalPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Silently fail if localStorage is full
  }
}

export { DEFAULT_PREFERENCES };
