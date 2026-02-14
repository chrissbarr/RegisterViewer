import { useEffect } from 'react';
import { useAppState } from '../../context/app-context';
import { saveToLocalStorage } from '../../utils/storage';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { MainPanel } from '../viewer/main-panel';

export function AppShell() {
  const state = useAppState();

  // Sync theme class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
  }, [state.theme]);

  // Auto-save to localStorage
  useEffect(() => {
    saveToLocalStorage(state);
  }, [state]);

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <MainPanel />
      </div>
    </div>
  );
}
