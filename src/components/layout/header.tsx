import { useRef, useState } from 'react';
import { DropdownMenu, type MenuItem } from '../common/dropdown-menu';
import { AboutDialog } from '../common/about-dialog';
import { ConfirmClearDialog } from '../common/confirm-clear-dialog';
import { ExamplesDialog } from '../common/examples-dialog';
import { ProjectSettingsDialog } from '../common/project-settings-dialog';
import { ImportResultDialog } from '../common/import-result-dialog';
import { Toast } from '../common/toast';
import { GithubIcon, MenuIcon } from 'lucide-react';
import { SaveButton } from '../common/save-button';
import { ShareButton } from '../common/share-button';
import { ShareDialog } from '../common/share-dialog';
import { MyProjectsDialog } from '../projects/my-projects-dialog';
import { GITHUB_URL } from '../../constants';
import { useAppState, useAppDispatch } from '../../context/app-context';
import { useEditContext } from '../../context/edit-context';
import { usePreferences, usePreferencesActions } from '../../context/preferences-context';
import { useProjectStorageActions } from '../../context/project-storage-context';
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
  const { exitEditMode } = useEditContext();
  const preferences = usePreferences();
  const preferencesActions = usePreferencesActions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [myProjectsOpen, setMyProjectsOpen] = useState(false);
  const [shareProjectLocalId, setShareProjectLocalId] = useState<string | null>(null);
  const [importFeedback, setImportFeedback] = useState<ImportFeedback | null>(null);
  const { createNewProject, switchProject } = useProjectStorageActions();

  function applyImportedData(json: string, showSuccessToast = true) {
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
      exitEditMode();
      dispatch({ type: 'IMPORT_STATE', registers: result.registers, values: result.values, project: result.project, addressUnitBits: result.addressUnitBits });
    }
  }

  function handleExampleLoad(json: string) {
    applyImportedData(json, false);
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
      applyImportedData(reader.result as string);
    };
    reader.readAsText(file);
    // Reset so the same file can be imported again
    e.target.value = '';
  }

  function clearFeedback() {
    setImportFeedback(null);
  }

  const cloudEnabled = isCloudEnabled();

  const menuItems: MenuItem[] = [
    { kind: 'action', label: 'Project settings', onAction: () => setProjectSettingsOpen(true) },
    { kind: 'separator' },
    { kind: 'action', label: 'Import', onAction: handleImport },
    { kind: 'action', label: 'Export', onAction: handleExport },
    { kind: 'action', label: 'Examples', onAction: () => setExamplesOpen(true) },
    { kind: 'action', label: 'Clear workspace', onAction: () => setClearDialogOpen(true) },
    { kind: 'separator' },
    { kind: 'action', label: 'New project', onAction: () => {
      const localId = createNewProject();
      switchProject(localId);
    }},
    { kind: 'action', label: 'My Projects', onAction: () => setMyProjectsOpen(true) },
    { kind: 'separator' },
    {
      kind: 'toggle',
      label: 'Dark mode',
      checked: preferences.theme === 'dark',
      onToggle: () => preferencesActions.toggleTheme(),
    },
    { kind: 'separator' },
    { kind: 'action', label: 'About', onAction: () => setAboutOpen(true) },
    { kind: 'link', label: 'GitHub', href: GITHUB_URL, icon: <GithubIcon size={14} /> },
  ];

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
          {cloudEnabled && <SaveButton />}
          <DropdownMenu
            items={menuItems}
            triggerLabel="Application menu"
            triggerContent={<MenuIcon size={16} className="block" />}
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
          <ConfirmClearDialog
            open={clearDialogOpen}
            onClose={() => setClearDialogOpen(false)}
            onConfirm={() => {
              exitEditMode();
              dispatch({ type: 'CLEAR_WORKSPACE' });
            }}
          />
          <MyProjectsDialog
            open={myProjectsOpen}
            onClose={() => setMyProjectsOpen(false)}
            onShareProject={(localId) => {
              setMyProjectsOpen(false);
              setShareProjectLocalId(localId);
            }}
          />
          <ShareDialog
            open={shareProjectLocalId !== null}
            projectLocalId={shareProjectLocalId}
            onClose={() => {
              setShareProjectLocalId(null);
              setMyProjectsOpen(true);
            }}
          />
        </div>
      </header>

      {importFeedback?.kind === 'success' && (
        <Toast
          message={importFeedback.message}
          variant="success"
          duration={3000}
          onDismiss={clearFeedback}
        />
      )}

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
