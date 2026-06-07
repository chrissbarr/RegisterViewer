import { useEffect, useRef, useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, type AppState } from '../../types/register';
import type { UnsavedProjectSource } from '../../types/project';
import { isSaveSuccess, type CloudInit } from '../../types/cloud-sync';
import { useAppState } from '../../context/app-context';
import { EditProvider } from '../../context/edit-context';
import { PreferencesProvider, usePreferences, usePreferencesActions } from '../../context/preferences-context';
import { ProjectStorageProvider, useProjectStorage } from '../../context/project-storage-context';
import { CloudSyncProvider, useCloudSync, useCloudSyncActions } from '../../context/cloud-sync-context';
import { serializeState } from '../../utils/storage';
import { patchProjectState, saveUnsavedProjectState, type ProjectStorageWriteResult } from '../../utils/project-storage';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { MainPanel } from '../viewer/main-panel';
import { Toast } from '../common/toast';
import { CloudConflictBanner } from '../common/cloud-conflict-banner';
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
  cloudInit?: CloudInit;
  initialLocalId?: string | null;
  initialUnsaved?: { name: string; source: UnsavedProjectSource } | null;
}

interface PendingLocalSave {
  state: AppState;
  localId: string | null;
  isUnsaved: boolean;
  unsavedName: string | null;
  unsavedSource: UnsavedProjectSource;
}

function warnLocalSaveFailure(scope: string, result: ProjectStorageWriteResult): void {
  if (result.ok || !import.meta.env.DEV) return;
  console.warn(`[app-shell] ${scope} failed:`, result.status, result.error);
}

function localSaveOk(): ProjectStorageWriteResult {
  return { ok: true, status: 'ok', evictedLocalIds: [] };
}

function persistPendingLocalSave(pending: PendingLocalSave): ProjectStorageWriteResult {
  if (pending.isUnsaved) {
    const name = pending.state.project?.title?.trim() || pending.unsavedName || 'Untitled Project';
    const result = saveUnsavedProjectState(name, serializeState(pending.state), pending.unsavedSource);
    warnLocalSaveFailure('Unsaved project local save', result);
    return result;
  }

  if (!pending.localId) return localSaveOk();
  const result = patchProjectState(pending.localId, serializeState(pending.state));
  warnLocalSaveFailure('Saved project local save', result);
  return result;
}

function AppShellInner({ cloudInit }: AppShellProps) {
  const state = useAppState();
  const preferences = usePreferences();
  const preferencesActions = usePreferencesActions();
  const pendingSaveRef = useRef<PendingLocalSave | null>(null);
  const [localSaveError, setLocalSaveError] = useState<string | null>(null);
  const cloud = useCloudSync();
  const cloudActions = useCloudSyncActions();
  const { activeLocalId, isUnsaved, unsavedName, unsavedSource } = useProjectStorage();

  const activeLocalIdRef = useRef(activeLocalId);
  useEffect(() => { activeLocalIdRef.current = activeLocalId; }, [activeLocalId]);

  // Initialize cloud state from props (when loaded from #/p/{id} URL)
  const cloudInitRef = useRef(cloudInit);
  useEffect(() => {
    const init = cloudInitRef.current;
    if (init) {
      cloudActions.initFromProject(init.projectId, init.isOwner, init.storage, {
        serverVersion: init.serverVersion,
        cloudSavedAt: init.cloudSavedAt,
        visibility: init.visibility,
        cloudConflictVersion: init.cloudConflictVersion,
        hasUnsyncedChanges: init.hasUnsyncedChanges,
      });
      cloudInitRef.current = undefined;
    }
  }, [cloudActions]);

  // Auto-save to localStorage (debounced). Branches on unsaved vs saved project.
  useEffect(() => {
    if (!activeLocalId && !isUnsaved) return;
    const pending: PendingLocalSave = {
      state,
      localId: activeLocalId,
      isUnsaved,
      unsavedName,
      unsavedSource: unsavedSource ?? 'new',
    };
    pendingSaveRef.current = pending;
    const timer = setTimeout(() => {
      // Defense-in-depth: if the active project changed since this save was
      // scheduled, the in-memory state no longer belongs to pending.localId — skip.
      if (!pending.isUnsaved && pending.localId !== activeLocalIdRef.current) return;
      const result = persistPendingLocalSave(pending);
      if (result.ok && pendingSaveRef.current === pending) {
        pendingSaveRef.current = null;
        setLocalSaveError(null);
      } else if (!result.ok) {
        setLocalSaveError('Local save failed. Keep this tab open and free browser storage before continuing.');
      }
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state, activeLocalId, isUnsaved, unsavedName, unsavedSource]);

  // Flush any pending save on unmount or page unload.
  // Ref-based so the effect is set up once — avoids stale-closure flush
  // when cloudActions identity changes after a cloud save.
  const cloudActionsRef = useRef(cloudActions);
  useEffect(() => {
    cloudActionsRef.current = cloudActions;
  }, [cloudActions]);

  useEffect(() => {
    const flush = (showError: boolean) => {
      const pending = pendingSaveRef.current;
      if (pending !== null) {
        const result = persistPendingLocalSave(pending);
        if (result.ok) {
          pendingSaveRef.current = null;
          if (showError) setLocalSaveError(null);
        } else if (showError) {
          setLocalSaveError('Local save failed. Keep this tab open and free browser storage before continuing.');
        }
      }
      // Best-effort cloud sync flush (fire-and-forget on unload).
      cloudActionsRef.current.flushCloudSync().catch(() => {});
    };
    const flushWithError = () => flush(true);
    window.addEventListener('beforeunload', flushWithError);
    window.addEventListener('pagehide', flushWithError);
    return () => {
      window.removeEventListener('beforeunload', flushWithError);
      window.removeEventListener('pagehide', flushWithError);
      flush(false);
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
      {cloud.conflict && (
        <div className="mx-4 mt-3 shrink-0">
          <CloudConflictBanner
            serverVersion={cloud.conflict.serverVersion}
            onKeepLocalVersion={async () => {
              const outcome = await cloudActions.saveToCloud();
              if (!isSaveSuccess(outcome)) {
                throw new Error('Could not save your changes. Please try again.');
              }
            }}
            onLoadServerVersion={cloudActions.loadServerVersion}
          />
        </div>
      )}
      <AnimatePresence>
        {localSaveError && (
          <Toast
            message={localSaveError}
            variant="error"
            duration={8000}
            onDismiss={() => setLocalSaveError(null)}
          />
        )}
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
      <LoginDialog open={cloud.loginRequired} onClose={cloudActions.dismissLogin} />
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
