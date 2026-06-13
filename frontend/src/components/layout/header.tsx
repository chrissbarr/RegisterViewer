import { useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { DropdownMenu, type MenuItem } from '../common/dropdown-menu';
import { AboutDialog } from '../common/about-dialog';
import { ExamplesDialog } from '../common/examples-dialog';
import { ProjectSettingsDialog } from '../common/project-settings-dialog';
import { ImportResultDialog } from '../common/import-result-dialog';
import { Toast } from '../common/toast';
import { UnsavedPromptDialog } from '../common/unsaved-prompt-dialog';
import { GithubIcon, MenuIcon } from 'lucide-react';
import { SyncStatusIndicator } from '../common/sync-status-indicator';
import { useCloudSync } from '../../context/cloud-sync-context';
import { ShareButton } from '../common/share-button';
import { MyProjectsDialog } from '../projects/my-projects-dialog';
import { LoginDialog } from '../auth/login-dialog';
import { GITHUB_URL } from '../../constants';
import { useAppState, useAppDispatch } from '../../context/app-context';
import { useAuth, useAuthActions } from '../../context/auth-context';
import { usePreferences, usePreferencesActions } from '../../context/preferences-context';
import { useProjectStorage, useProjectStorageActions } from '../../context/project-storage-context';
import { useUnsavedGuard } from '../../hooks/use-unsaved-guard';
import { exportToJson, importFromJson, type ImportWarning } from '../../utils/storage';
import { triggerFileDownload } from '../../utils/file-download';
import { isCloudEnabled } from '../../utils/api-client';

type ImportFeedback =
  | { kind: 'success'; message: string }
  | { kind: 'warning'; importedCount: number; skippedCount: number; warnings: ImportWarning[] }
  | { kind: 'error'; message: string };

export function Header() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const preferences = usePreferences();
  const preferencesActions = usePreferencesActions();
  const auth = useAuth();
  const authActions = useAuthActions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [myProjectsOpen, setMyProjectsOpen] = useState(false);
  const [importFeedback, setImportFeedback] = useState<ImportFeedback | null>(null);
  const { isUnsaved } = useProjectStorage();
  const { loadAsUnsaved, switchProject, saveCurrentProject } = useProjectStorageActions();
  const cloud = useCloudSync();
  const unsavedGuard = useUnsavedGuard();

  function processImport(json: string, name: string, showSuccessToast = true) {
    const result = importFromJson(json);
    if (!result) {
      setImportFeedback({ kind: 'error', message: 'Failed to import: invalid JSON or missing registers array.' });
      return;
    }

    if (result.warnings.length > 0) {
      setImportFeedback({
        kind: 'warning',
        importedCount: result.registers.length,
        skippedCount: result.warnings.length,
        warnings: result.warnings,
      });
    } else if (showSuccessToast && result.registers.length > 0) {
      setImportFeedback({
        kind: 'success',
        message: `Imported ${result.registers.length} register${result.registers.length !== 1 ? 's' : ''} successfully.`,
      });
    } else {
      setImportFeedback(null);
    }

    if (result.registers.length > 0) {
      if (!loadAsUnsaved(result, name, 'import')) {
        setImportFeedback({ kind: 'error', message: 'Failed to import: current project could not be saved locally.' });
      }
    }
  }

  function handleExampleLoad(json: string, name: string) {
    unsavedGuard.guard(() => {
      const result = importFromJson(json);
      if (!result || result.registers.length === 0) return;
      if (loadAsUnsaved(result, name, 'example')) {
        setExamplesOpen(false);
      }
    });
  }

  function handleExport() {
    const json = exportToJson(state, true);
    const blob = new Blob([json], { type: 'application/json' });
    const slug = state.project?.title
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    triggerFileDownload(blob, slug ? `${slug}.json` : 'register-definitions.json');
  }

  function handleImport() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const json = reader.result as string;
      const name = file.name.replace(/\.json$/i, '') || 'Imported Project';
      unsavedGuard.guard(() => {
        processImport(json, name);
      });
    };
    reader.readAsText(file);
    // Reset so the same file can be imported again
    e.target.value = '';
  }

  function handleNewProject() {
    unsavedGuard.guard(() => {
      void loadAsUnsaved(
        { registers: [], values: {}, warnings: [] },
        'Untitled Project',
        'new',
      );
    });
  }

  function handleNewProjectFromMyProjects() {
    unsavedGuard.guard(() => {
      const loaded = loadAsUnsaved(
        { registers: [], values: {}, warnings: [] },
        'Untitled Project',
        'new',
      );
      if (loaded) setMyProjectsOpen(false);
    });
  }

  function handleSwitchProject(localId: string) {
    let switched = false;
    unsavedGuard.guard(() => {
      switched = switchProject(localId);
      if (switched) setMyProjectsOpen(false);
    });
    return switched;
  }

  function clearFeedback() {
    setImportFeedback(null);
  }

  const cloudEnabled = isCloudEnabled();

  const menuItems: MenuItem[] = [
    { kind: 'action', label: 'New project', onAction: handleNewProject },
    ...(isUnsaved
      ? [{ kind: 'action' as const, label: 'Save project', onAction: () => saveCurrentProject() }]
      : []),
    { kind: 'action', label: 'My Projects', onAction: () => setMyProjectsOpen(true) },
    { kind: 'action', label: 'Project settings', onAction: () => setProjectSettingsOpen(true) },
    { kind: 'separator' },
    { kind: 'action', label: 'Import', onAction: handleImport },
    { kind: 'action', label: 'Export', onAction: handleExport },
    { kind: 'action', label: 'Examples', onAction: () => setExamplesOpen(true) },
    { kind: 'separator' },
    {
      kind: 'toggle',
      label: 'Dark mode',
      checked: preferences.theme === 'dark',
      onToggle: () => preferencesActions.toggleTheme(),
    },
    { kind: 'action', label: 'About', onAction: () => setAboutOpen(true) },
    { kind: 'link', label: 'GitHub', href: GITHUB_URL, icon: <GithubIcon size={14} /> },
    ...(cloudEnabled && !auth.user
      ? [
          { kind: 'separator' as const },
          { kind: 'action' as const, label: 'Sign in', onAction: () => setLoginDialogOpen(true) },
        ]
      : []),
  ];

  const menuFooter = cloudEnabled && auth.user ? (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
      <span className="truncate mr-2">{auth.user.email}</span>
      <button
        onClick={() => { void authActions.logout(); }}
        className="shrink-0 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
      >
        Sign out
      </button>
    </div>
  ) : undefined;

  return (
    <>
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
        <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">
          Register Viewer
          {state.project?.title && (
            <span className="font-normal text-gray-500 dark:text-gray-400">
              {' \u2014 '}{state.project.title}
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          <ShareButton />
          {cloudEnabled && <SyncStatusIndicator status={cloud.syncStatus} />}
          <DropdownMenu
            items={menuItems}
            triggerLabel="Application menu"
            triggerContent={<MenuIcon size={16} className="block" />}
            footer={menuFooter}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />
          <ProjectSettingsDialog
            open={projectSettingsOpen}
            onClose={() => setProjectSettingsOpen(false)}
            initialData={{ metadata: state.project ?? {}, addressUnitBits: state.addressUnitBits }}
            onSave={(data) => {
              dispatch({ type: 'SET_PROJECT_METADATA', project: data.metadata });
              dispatch({ type: 'SET_ADDRESS_UNIT_BITS', addressUnitBits: data.addressUnitBits });
            }}
          />
          <ExamplesDialog
            open={examplesOpen}
            onClose={() => setExamplesOpen(false)}
            onLoad={handleExampleLoad}
          />
          <AboutDialog
            open={aboutOpen}
            onClose={() => setAboutOpen(false)}
          />
          <MyProjectsDialog
            open={myProjectsOpen}
            onClose={() => setMyProjectsOpen(false)}
            onSwitchProject={handleSwitchProject}
            onNewProject={handleNewProjectFromMyProjects}
            onSaveProject={isUnsaved ? () => saveCurrentProject() : undefined}
          />
          <LoginDialog
            open={loginDialogOpen}
            onClose={() => setLoginDialogOpen(false)}
          />
          <UnsavedPromptDialog
            open={unsavedGuard.promptOpen}
            onSaveAndContinue={unsavedGuard.executePending}
            onDiscardAndContinue={unsavedGuard.executePending}
            onCancel={unsavedGuard.cancelPending}
          />
        </div>
      </header>

      <AnimatePresence>
        {importFeedback?.kind === 'success' && (
          <Toast
            message={importFeedback.message}
            variant="success"
            duration={3000}
            onDismiss={clearFeedback}
          />
        )}
      </AnimatePresence>

      <ImportResultDialog
        open={importFeedback?.kind === 'error' || importFeedback?.kind === 'warning'}
        onClose={clearFeedback}
        variant={importFeedback?.kind === 'error' ? 'error' : 'warning'}
        importedCount={importFeedback?.kind === 'warning' ? importFeedback.importedCount : 0}
        skippedCount={importFeedback?.kind === 'warning' ? importFeedback.skippedCount : 0}
        warnings={importFeedback?.kind === 'warning' ? importFeedback.warnings : []}
        errorMessage={importFeedback?.kind === 'error' ? importFeedback.message : undefined}
      />
    </>
  );
}
