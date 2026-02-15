import { useState } from 'react';
import { useAppState, useAppDispatch } from '../../context/app-context';
import { useEditContext } from '../../context/edit-context';
import { ValueInputBar } from './value-input-bar';
import { BitGrid } from './bit-grid';
import { FieldTable } from './field-table';
import { RegisterEditor } from '../editor/register-editor';
import type { RegisterDef } from '../../types/register';
import { formatOffset } from '../../utils/format';

export function MainPanel() {
  const { registers, activeRegisterId } = useAppState();
  const dispatch = useAppDispatch();
  const [hoveredFieldIndex, setHoveredFieldIndex] = useState<number | null>(null);
  const {
    dirtyCount,
    isEditing,
    enterEditMode,
    getDraft,
    setDraft,
    saveDraft,
    discardDraft,
    saveAllDrafts,
    discardAllDrafts,
  } = useEditContext();

  const activeRegister = registers.find((r) => r.id === activeRegisterId);
  const activeDraft = activeRegisterId ? getDraft(activeRegisterId) : undefined;

  function handleDraftChange(updated: RegisterDef) {
    setDraft(updated.id, updated);
  }

  function handleSave() {
    if (!activeRegisterId) return;
    const draft = saveDraft(activeRegisterId);
    if (draft) {
      dispatch({ type: 'UPDATE_REGISTER', register: draft });
    }
  }

  function handleCancel() {
    if (!activeRegisterId) return;
    discardDraft(activeRegisterId);
  }

  function handleSaveAll() {
    const allDrafts = saveAllDrafts();
    for (const draft of allDrafts) {
      dispatch({ type: 'UPDATE_REGISTER', register: draft });
    }
  }

  function handleCancelAll() {
    discardAllDrafts();
  }

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

  if (isEditing && activeDraft) {
    return (
      <main className="flex-1 overflow-y-auto p-4">
        <RegisterEditor
          draft={activeDraft}
          onDraftChange={handleDraftChange}
          onSave={handleSave}
          onCancel={handleCancel}
          onSaveAll={dirtyCount > 1 ? handleSaveAll : undefined}
          onCancelAll={dirtyCount > 1 ? handleCancelAll : undefined}
          dirtyCount={dirtyCount}
        />
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-4">
      <div className="bg-white dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold">{activeRegister.name}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {activeRegister.offset != null && `${formatOffset(activeRegister.offset)} · `}
              {activeRegister.width}-bit register
              {activeRegister.description && ` — ${activeRegister.description}`}
            </p>
          </div>
          <button
            onClick={() => enterEditMode(activeRegister)}
            className="px-3 py-1.5 rounded-md text-sm font-medium
              bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300
              hover:bg-blue-200 dark:hover:bg-blue-800/40 transition-colors"
          >
            Edit
          </button>
        </div>
        <ValueInputBar register={activeRegister} />
        <BitGrid register={activeRegister} hoveredFieldIndex={hoveredFieldIndex} onFieldHover={setHoveredFieldIndex} />
      </div>
      <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2 mt-6">
        Field Breakdown
      </h3>
      <FieldTable register={activeRegister} hoveredFieldIndex={hoveredFieldIndex} onFieldHover={setHoveredFieldIndex} />
    </main>
  );
}
