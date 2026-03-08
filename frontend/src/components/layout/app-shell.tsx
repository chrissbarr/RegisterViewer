import { useEffect, useRef, useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, type AppState } from '../../types/register';
import type { UnsavedProjectSource } from '../../types/project';
import { useAppState } from '../../context/app-context';
import { EditProvider } from '../../context/edit-context';
import { PreferencesProvider, usePreferences, usePreferencesActions } from '../../context/preferences-context';
import { ProjectStorageProvider, useProjectStorage } from '../../context/project-storage-context';
import { CloudSyncProvider, useCloudSync, useCloudSyncActions } from '../../context/cloud-sync-context';
import { serializeState } from '../../utils/storage';
import { patchProjectState, saveUnsavedProjectState } from '../../utils/project-storage';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { MainPanel } from '../viewer/main-panel';
import { Toast } from '../common/toast';
import { LoginDialog } from '../auth/login-dialog';
import { ToastPortalProvider } from '../../context/toast-portal-context';
import { AuthProvider } from '../../context/auth-context';
import { SAVE_DEBOUNCE_MS } from '../../constants';

/**
 * Props for the AppShell component.
 *
 * Note: While both `cloudInit` and `initialLocalId` are defined here,
 * they flow to different destinations:
 * - `cloudInit` is consumed by `AppShellInner` to initialize cloud sync state
 * - `initialLocalId` is consumed by the outer `AppShell` and passed to `ProjectStorageProvider`
 */
interface AppShellProps {
  cloudInit?: { projectId: string; isOwner: boolean };
  initialLocalId?: string | null;
  initialUnsaved?: { name: string; source: UnsavedProjectSource } | null;
}

function AppShellInner({ cloudInit }: AppShellProps) {
  const state = useAppState();
  const preferences = usePreferences();
  const preferencesActions = usePreferencesActions();
  const pendingStateRef = useRef<AppState | null>(null);
  const cloud = useCloudSync();
  const cloudActions = useCloudSyncActions();
  const { activeLocalId, isUnsaved, unsavedName } = useProjectStorage();

  // Initialize cloud state from props (when loaded from #/p/{id} URL)
  const cloudInitRef = useRef(cloudInit);
  useEffect(() => {
    const init = cloudInitRef.current;
    if (init) {
      cloudActions.initFromProject(init.projectId, init.isOwner);
      cloudInitRef.current = undefined;
    }
  }, [cloudActions]);

  // Ref updates for debounced save/flush (avoids stale closures).
  // Safe to use useEffect because the 300ms debounce timer ensures refs are
  // updated before the timeout fires.
  const activeLocalIdRef = useRef(activeLocalId);
  useEffect(() => { activeLocalIdRef.current = activeLocalId; }, [activeLocalId]);

  const isUnsavedRef = useRef(isUnsaved);
  useEffect(() => { isUnsavedRef.current = isUnsaved; }, [isUnsaved]);

  const unsavedNameRef = useRef(unsavedName);
  useEffect(() => { unsavedNameRef.current = unsavedName; }, [unsavedName]);

  // Auto-save to localStorage (debounced). Branches on unsaved vs saved project.
  useEffect(() => {
    if (!activeLocalId && !isUnsaved) return;
    pendingStateRef.current = state;
    const timer = setTimeout(() => {
      if (isUnsavedRef.current) {
        const name = state.project?.title?.trim() || unsavedNameRef.current || 'Untitled Project';
        try {
          saveUnsavedProjectState(name, serializeState(state));
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn('[app-shell] Failed to save unsaved project:', err);
          }
        }
      } else {
        const id = activeLocalIdRef.current;
        if (id) {
          patchProjectState(id, serializeState(state));
        }
      }
      pendingStateRef.current = null;
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state, activeLocalId, isUnsaved]);

  // Flush any pending save on unmount or page unload.
  // Ref-based so the effect is set up once — avoids stale-closure flush
  // when cloudActions identity changes after a cloud save.
  const cloudActionsRef = useRef(cloudActions);
  useEffect(() => {
    cloudActionsRef.current = cloudActions;
  }, [cloudActions]);

  useEffect(() => {
    const flush = () => {
      if (pendingStateRef.current !== null) {
        if (isUnsavedRef.current) {
          const name = pendingStateRef.current.project?.title?.trim() || unsavedNameRef.current || 'Untitled Project';
          try {
            saveUnsavedProjectState(name, serializeState(pendingStateRef.current));
          } catch { /* best effort */ }
        } else {
          const id = activeLocalIdRef.current;
          if (id) {
            patchProjectState(id, serializeState(pendingStateRef.current));
          }
        }
        pendingStateRef.current = null;
      }
      // Best-effort cloud sync flush (fire-and-forget on unload).
      cloudActionsRef.current.flushSync().catch(() => {});
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
  const collapsedRef = useRef(preferences.sidebarCollapsed);
  useEffect(() => {
    collapsedRef.current = preferences.sidebarCollapsed;
  }, [preferences.sidebarCollapsed]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        preferencesActions.setSidebarCollapsed(!collapsedRef.current);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preferencesActions]);

  // Drag-to-resize sidebar
  const dragRef = useRef<{ startX: number; startWidth: number; lastWidth: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const handleResizerPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: preferences.sidebarWidth, lastWidth: preferences.sidebarWidth };
    setIsResizing(true);
  }, [preferences.sidebarWidth]);

  const handleResizerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const delta = e.clientX - dragRef.current.startX;
    const newWidth = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, dragRef.current.startWidth + delta));
    if (newWidth !== dragRef.current.lastWidth) {
      dragRef.current.lastWidth = newWidth;
      preferencesActions.setSidebarWidth(newWidth);
    }
  }, [preferencesActions]);

  const handleResizerPointerUp = useCallback(() => {
    dragRef.current = null;
    setIsResizing(false);
  }, []);

  const collapsed = preferences.sidebarCollapsed;
  const sidebarWidth = collapsed ? 0 : preferences.sidebarWidth;

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Header />
      <AnimatePresence>
        {cloud.error && (
          <Toast
            message={cloud.error}
            variant="error"
            duration={5000}
            onDismiss={cloudActions.dismissError}
          />
        )}
      </AnimatePresence>
      <div className="flex flex-1 overflow-hidden relative">
        <AnimatePresence>
          {collapsed && (
            <motion.button
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
              onClick={() => preferencesActions.setSidebarCollapsed(false)}
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
              <ChevronRight size={12} />
            </motion.button>
          )}
        </AnimatePresence>

        <Sidebar
          width={sidebarWidth}
          collapsed={collapsed}
          isResizing={isResizing}
          onToggleCollapse={() => preferencesActions.setSidebarCollapsed(!collapsed)}
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

      {/* Login dialog triggered by cloud ops when unauthenticated */}
      <LoginDialog open={cloud.loginRequired} onClose={cloudActions.cancelPendingOp} />
    </div>
  );
}

export function AppShell({ cloudInit, initialLocalId, initialUnsaved }: AppShellProps) {
  return (
    <AuthProvider>
      <ToastPortalProvider>
        <PreferencesProvider>
          <EditProvider>
            <ProjectStorageProvider initialLocalId={initialLocalId ?? null} initialUnsaved={initialUnsaved}>
              <CloudSyncProvider>
                <AppShellInner cloudInit={cloudInit} />
              </CloudSyncProvider>
            </ProjectStorageProvider>
          </EditProvider>
        </PreferencesProvider>
      </ToastPortalProvider>
    </AuthProvider>
  );
}
