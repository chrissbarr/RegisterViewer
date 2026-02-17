import { useEffect, useRef } from 'react';
import type { AppState } from '../../types/register';
import { useAppState } from '../../context/app-context';
import { EditProvider } from '../../context/edit-context';
import { saveToLocalStorage } from '../../utils/storage';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { MainPanel } from '../viewer/main-panel';

const SAVE_DEBOUNCE_MS = 300;

export function AppShell() {
  const state = useAppState();
  const pendingStateRef = useRef<AppState | null>(null);

  // Sync theme class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
  }, [state.theme]);

  // Auto-save to localStorage (debounced)
  useEffect(() => {
    pendingStateRef.current = state;
    const timer = setTimeout(() => {
      saveToLocalStorage(state);
      pendingStateRef.current = null;
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state]);

  // Flush any pending save on unmount or page unload
  useEffect(() => {
    const flush = () => {
      if (pendingStateRef.current !== null) {
        saveToLocalStorage(pendingStateRef.current);
        pendingStateRef.current = null;
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

  return (
    <EditProvider>
      <div className="h-screen flex flex-col bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        <Header />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <MainPanel />
        </div>
      </div>
    </EditProvider>
  );
}
