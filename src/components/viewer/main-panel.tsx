import { useState } from 'react';
import { useAppState } from '../../context/app-context';
import { ValueInputBar } from './value-input-bar';
import { BitGrid } from './bit-grid';
import { FieldTable } from './field-table';
import { RegisterEditor } from '../editor/register-editor';

export function MainPanel() {
  const { registers, activeRegisterId } = useAppState();
  const activeRegister = registers.find((r) => r.id === activeRegisterId);
  const [editMode, setEditMode] = useState(false);

  if (!activeRegister) {
    return (
      <main className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-500">
        <div className="text-center">
          <p className="text-lg mb-2">No register selected</p>
          <p className="text-sm">Add a register from the sidebar to get started.</p>
        </div>
      </main>
    );
  }

  if (editMode) {
    return (
      <main className="flex-1 overflow-y-auto p-4">
        <RegisterEditor register={activeRegister} onClose={() => setEditMode(false)} />
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold">{activeRegister.name}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {activeRegister.width}-bit register
            {activeRegister.description && ` — ${activeRegister.description}`}
          </p>
        </div>
        <button
          onClick={() => setEditMode(true)}
          className="px-3 py-1.5 rounded-md text-sm font-medium
            bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300
            hover:bg-blue-200 dark:hover:bg-blue-800/40 transition-colors"
        >
          Edit
        </button>
      </div>
      <ValueInputBar register={activeRegister} />
      <BitGrid register={activeRegister} />
      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2 mt-6">
        Field Breakdown
      </h3>
      <FieldTable register={activeRegister} />
    </main>
  );
}
