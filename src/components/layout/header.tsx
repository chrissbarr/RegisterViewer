import { useRef } from 'react';
import { ThemeToggle } from '../common/theme-toggle';
import { useAppState, useAppDispatch } from '../../context/app-context';
import { exportToJson, importFromJson } from '../../utils/storage';

export function Header() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const result = importFromJson(reader.result as string);
      if (result) {
        dispatch({ type: 'IMPORT_REGISTERS', registers: result.registers });
        // Restore values for imported registers
        for (const [id, value] of Object.entries(result.values)) {
          dispatch({ type: 'SET_REGISTER_VALUE', registerId: id, value });
        }
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be imported again
    e.target.value = '';
  }

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
      <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">
        Register Viewer
      </h1>
      <div className="flex items-center gap-2">
        <button
          onClick={handleImport}
          className="px-3 py-1.5 rounded-md text-sm font-medium
            bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200
            hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          Import
        </button>
        <button
          onClick={handleExport}
          className="px-3 py-1.5 rounded-md text-sm font-medium
            bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200
            hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          Export
        </button>
        <ThemeToggle />
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </header>
  );
}
