import { useEffect, useRef, useCallback } from 'react';
import { SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, type AppState } from '../../types/register';
import { useAppState, useAppDispatch } from '../../context/app-context';
import { EditProvider } from '../../context/edit-context';
import { CloudProjectProvider, useCloudProject, useCloudActions } from '../../context/cloud-context';
import { saveToLocalStorage } from '../../utils/storage';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { MainPanel } from '../viewer/main-panel';
import { SharedProjectBanner } from '../common/shared-project-banner';
import { Toast } from '../common/toast';

const SAVE_DEBOUNCE_MS = 300;

interface AppShellProps {
  cloudInit?: { projectId: string; isOwner: boolean };
}

function AppShellInner({ cloudInit }: AppShellProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const pendingStateRef = useRef<AppState | null>(null);
  const cloud = useCloudProject();
  const cloudActions = useCloudActions();

  // Initialize cloud state from props (when loaded from #/p/{id} URL)
  const cloudInitRef = useRef(cloudInit);
  useEffect(() => {
    const init = cloudInitRef.current;
    if (init) {
      cloudActions.setProjectId(init.projectId, init.isOwner);
      cloudInitRef.current = undefined;
    }
  }, [cloudActions]);

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

  // Keyboard shortcut: Ctrl+B toggles sidebar collapse
  const collapsedRef = useRef(state.sidebarCollapsed);
  useEffect(() => {
    collapsedRef.current = state.sidebarCollapsed;
  }, [state.sidebarCollapsed]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        dispatch({ type: 'SET_SIDEBAR_COLLAPSED', collapsed: !collapsedRef.current });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dispatch]);

  // Drag-to-resize sidebar
  const dragRef = useRef<{ startX: number; startWidth: number; lastWidth: number } | null>(null);

  const handleResizerPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: state.sidebarWidth, lastWidth: state.sidebarWidth };
  }, [state.sidebarWidth]);

  const handleResizerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const delta = e.clientX - dragRef.current.startX;
    const newWidth = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, dragRef.current.startWidth + delta));
    if (newWidth !== dragRef.current.lastWidth) {
      dragRef.current.lastWidth = newWidth;
      dispatch({ type: 'SET_SIDEBAR_WIDTH', width: newWidth });
    }
  }, [dispatch]);

  const handleResizerPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const collapsed = state.sidebarCollapsed;
  const sidebarWidth = collapsed ? 0 : state.sidebarWidth;

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Header />
      <SharedProjectBanner />
      {cloud.error && (
        <Toast
          message={cloud.error}
          variant="error"
          duration={5000}
          onDismiss={cloudActions.dismissError}
        />
      )}
      <div className="flex flex-1 overflow-hidden relative">
        {collapsed && (
          <button
            onClick={() => dispatch({ type: 'SET_SIDEBAR_COLLAPSED', collapsed: false })}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-20
              w-5 h-10 flex items-center justify-center
              bg-gray-200 dark:bg-gray-800
              hover:bg-gray-300 dark:hover:bg-gray-700
              rounded-r-md border border-l-0
              border-gray-300 dark:border-gray-600
              text-gray-500 dark:text-gray-400
              transition-colors"
            title="Expand sidebar (Ctrl+B)"
            aria-label="Expand sidebar"
          >
            <svg viewBox="0 0 8 12" width="8" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="1,1 7,6 1,11" />
            </svg>
          </button>
        )}

        <Sidebar
          width={sidebarWidth}
          collapsed={collapsed}
          onToggleCollapse={() => dispatch({ type: 'SET_SIDEBAR_COLLAPSED', collapsed: !collapsed })}
        />

        {!collapsed && (
          <div
            onPointerDown={handleResizerPointerDown}
            onPointerMove={handleResizerPointerMove}
            onPointerUp={handleResizerPointerUp}
            onPointerCancel={handleResizerPointerUp}
            className="w-1 cursor-col-resize
              bg-gray-300 dark:bg-gray-700
              hover:bg-blue-400 dark:hover:bg-blue-600
              active:bg-blue-500 dark:active:bg-blue-500
              transition-colors shrink-0 select-none"
            title="Drag to resize sidebar"
          />
        )}

        <MainPanel />
      </div>
    </div>
  );
}

export function AppShell({ cloudInit }: AppShellProps) {
  return (
    <EditProvider>
      <CloudProjectProvider>
        <AppShellInner cloudInit={cloudInit} />
      </CloudProjectProvider>
    </EditProvider>
  );
}
