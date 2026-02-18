import { useRef, useState } from 'react';
import { DropdownMenu, type MenuItem } from '../common/dropdown-menu';
import { AboutDialog } from '../common/about-dialog';
import { ConfirmClearDialog } from '../common/confirm-clear-dialog';
import { ExamplesDialog } from '../common/examples-dialog';
import { GitHubIcon } from '../common/github-icon';
import { GITHUB_URL } from '../../constants';
import { useAppState, useAppDispatch } from '../../context/app-context';
import { useEditContext } from '../../context/edit-context';
import { exportToJson, importFromJson } from '../../utils/storage';

function MenuIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" className="block">
      <rect x="1" y="2" width="14" height="2" rx="0.5" />
      <rect x="1" y="7" width="14" height="2" rx="0.5" />
      <rect x="1" y="12" width="14" height="2" rx="0.5" />
    </svg>
  );
}

export function Header() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { exitEditMode } = useEditContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [importWarning, setImportWarning] = useState<string | null>(null);

  function applyImportedData(json: string) {
    const result = importFromJson(json);
    if (!result) {
      setImportWarning('Failed to import: invalid JSON or missing registers array.');
      return;
    }

    if (result.warnings.length > 0) {
      const skipped = result.warnings
        .map((w) => `"${w.registerName}": ${w.errors.map((e) => e.message).join('; ')}`)
        .join('\n');
      setImportWarning(
        `Imported ${result.registers.length} register(s). ` +
        `${result.warnings.length} skipped due to validation errors:\n${skipped}`
      );
    } else {
      setImportWarning(null);
    }

    if (result.registers.length > 0) {
      exitEditMode();
      dispatch({ type: 'IMPORT_STATE', registers: result.registers, values: result.values });
    }
  }

  function handleExport() {
    const json = exportToJson(state);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'register-definitions.json';
    a.click();
    URL.revokeObjectURL(url);
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

  const menuItems: MenuItem[] = [
    { kind: 'action', label: 'Import', onAction: handleImport },
    { kind: 'action', label: 'Export', onAction: handleExport },
    { kind: 'action', label: 'Examples', onAction: () => setExamplesOpen(true) },
    { kind: 'action', label: 'Clear workspace', onAction: () => setClearDialogOpen(true) },
    { kind: 'separator' },
    {
      kind: 'toggle',
      label: 'Dark mode',
      checked: state.theme === 'dark',
      onToggle: () => dispatch({ type: 'TOGGLE_THEME' }),
    },
    { kind: 'separator' },
    { kind: 'action', label: 'About', onAction: () => setAboutOpen(true) },
    { kind: 'link', label: 'GitHub', href: GITHUB_URL, icon: <GitHubIcon /> },
  ];

  return (
    <>
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
        <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">
          Register Viewer
        </h1>
        <div className="flex items-center gap-2">
          <DropdownMenu
            items={menuItems}
            triggerLabel="Application menu"
            triggerContent={<MenuIcon />}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />
          <ExamplesDialog
            open={examplesOpen}
            onClose={() => setExamplesOpen(false)}
            onLoad={applyImportedData}
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
        </div>
      </header>
      {importWarning && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
          <div className="whitespace-pre-wrap flex-1">{importWarning}</div>
          <button
            onClick={() => setImportWarning(null)}
            className="shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
