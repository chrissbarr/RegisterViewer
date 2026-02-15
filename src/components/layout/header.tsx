import { useRef, useState } from 'react';
import { DropdownMenu, type MenuItem } from '../common/dropdown-menu';
import { ExamplesDialog } from '../common/examples-dialog';
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

  function applyImportedData(json: string) {
    const result = importFromJson(json);
    if (result) {
      exitEditMode();
      dispatch({ type: 'IMPORT_REGISTERS', registers: result.registers });
      for (const [id, value] of Object.entries(result.values)) {
        dispatch({ type: 'SET_REGISTER_VALUE', registerId: id, value });
      }
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
    { kind: 'separator' },
    {
      kind: 'toggle',
      label: 'Dark mode',
      checked: state.theme === 'dark',
      onToggle: () => dispatch({ type: 'TOGGLE_THEME' }),
    },
  ];

  return (
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
      </div>
    </header>
  );
}
