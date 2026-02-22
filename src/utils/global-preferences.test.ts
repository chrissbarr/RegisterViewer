import { describe, it, expect, beforeEach } from 'vitest';
import { loadPreferences, savePreferences, DEFAULT_PREFERENCES } from './global-preferences';
import { SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_DEFAULT } from '../types/register';

const PREFS_KEY = 'register-viewer-prefs';

beforeEach(() => {
  localStorage.clear();
});

describe('loadPreferences', () => {
  it('returns defaults when nothing is stored', () => {
    const prefs = loadPreferences();
    expect(prefs).toEqual({
      theme: 'light',
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      sidebarCollapsed: false,
    });
  });

  it('parses valid stored preferences', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      theme: 'dark',
      sidebarWidth: 300,
      sidebarCollapsed: true,
    }));
    const prefs = loadPreferences();
    expect(prefs.theme).toBe('dark');
    expect(prefs.sidebarWidth).toBe(300);
    expect(prefs.sidebarCollapsed).toBe(true);
  });

  it('defaults theme to light for invalid theme value', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      theme: 'purple',
      sidebarWidth: 224,
      sidebarCollapsed: false,
    }));
    const prefs = loadPreferences();
    expect(prefs.theme).toBe('light');
  });

  it('clamps sidebarWidth below minimum', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      theme: 'light',
      sidebarWidth: 50,
      sidebarCollapsed: false,
    }));
    const prefs = loadPreferences();
    expect(prefs.sidebarWidth).toBe(SIDEBAR_WIDTH_MIN);
  });

  it('clamps sidebarWidth above maximum', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      theme: 'light',
      sidebarWidth: 9999,
      sidebarCollapsed: false,
    }));
    const prefs = loadPreferences();
    expect(prefs.sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);
  });

  it('uses default sidebarWidth for non-number value', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      theme: 'dark',
      sidebarWidth: 'wide',
      sidebarCollapsed: false,
    }));
    const prefs = loadPreferences();
    expect(prefs.sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  it('defaults sidebarCollapsed to false for truthy non-boolean', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      theme: 'light',
      sidebarWidth: 224,
      sidebarCollapsed: 'yes',
    }));
    const prefs = loadPreferences();
    expect(prefs.sidebarCollapsed).toBe(false);
  });

  it('handles corrupt JSON gracefully', () => {
    localStorage.setItem(PREFS_KEY, '{not valid');
    const prefs = loadPreferences();
    expect(prefs).toEqual(DEFAULT_PREFERENCES);
  });

  it('handles null stored value', () => {
    localStorage.setItem(PREFS_KEY, 'null');
    // JSON.parse('null') returns null, which has no properties — should fall back gracefully
    const prefs = loadPreferences();
    expect(prefs.theme).toBe('light');
  });
});

describe('savePreferences', () => {
  it('writes preferences to localStorage', () => {
    savePreferences({
      theme: 'dark',
      sidebarWidth: 250,
      sidebarCollapsed: true,
    });
    const raw = localStorage.getItem(PREFS_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.theme).toBe('dark');
    expect(parsed.sidebarWidth).toBe(250);
    expect(parsed.sidebarCollapsed).toBe(true);
  });

  it('overwrites existing preferences', () => {
    savePreferences({ theme: 'light', sidebarWidth: 200, sidebarCollapsed: false });
    savePreferences({ theme: 'dark', sidebarWidth: 300, sidebarCollapsed: true });
    const prefs = loadPreferences();
    expect(prefs.theme).toBe('dark');
    expect(prefs.sidebarWidth).toBe(300);
  });
});

describe('DEFAULT_PREFERENCES', () => {
  it('has expected default values', () => {
    expect(DEFAULT_PREFERENCES.theme).toBe('light');
    expect(DEFAULT_PREFERENCES.sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(DEFAULT_PREFERENCES.sidebarCollapsed).toBe(false);
  });
});
