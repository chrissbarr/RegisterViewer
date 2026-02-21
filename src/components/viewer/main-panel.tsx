import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppState, useAppDispatch } from '../../context/app-context';
import { useEditContext } from '../../context/edit-context';
import { ValueInputBar } from './value-input-bar';
import { BitGrid } from './bit-grid';
import { FieldTable } from './field-table';
import { RegisterEditor } from '../editor/register-editor';
import { RegisterMapView } from './register-map-view';
import type { RegisterDef } from '../../types/register';
import { formatOffset } from '../../utils/format';
import { validateRegisterDef } from '../../utils/validation';

type MainTab = 'register' | 'map';

export function MainPanel() {
  const { registers, activeRegisterId } = useAppState();
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState<MainTab>('register');
  const [hoveredFieldIndices, setHoveredFieldIndices] = useState<ReadonlySet<number> | null>(null);
  const {
    dirtyDraftIds,
    isEditing,
    enterEditMode,
    exitEditMode,
    getDraft,
    setDraft,
    saveAllDrafts,
  } = useEditContext();

  const [saveErrors, setSaveErrors] = useState<string[] | null>(null);

  const activeRegister = registers.find((r) => r.id === activeRegisterId);

  // Pre-compute singleton hover sets once per field list, shared by BitGrid and FieldTable
  const fieldHoverSets = useMemo(
    () => activeRegister?.fields.map((_, i) => new Set([i]) as ReadonlySet<number>) ?? [],
    [activeRegister?.fields],
  );
  const activeDraft = activeRegisterId ? getDraft(activeRegisterId) : undefined;

  function handleDraftChange(updated: RegisterDef) {
    setDraft(updated.id, updated);
    setSaveErrors(null);
  }

  function handleSave() {
    // Validate all dirty drafts before committing (saveAllDrafts destroys edit state)
    const errors: string[] = [];
    for (const id of dirtyDraftIds) {
      const draft = getDraft(id);
      if (!draft) continue;
      for (const e of validateRegisterDef(draft)) {
        errors.push(`${draft.name}: ${e.message}`);
      }
    }
    if (errors.length > 0) {
      setSaveErrors(errors);
      return;
    }

    setSaveErrors(null);
    const allDrafts = saveAllDrafts();
    for (const draft of allDrafts) {
      if (dirtyDraftIds.has(draft.id)) {
        dispatch({ type: 'UPDATE_REGISTER', register: draft });
      }
    }
  }

  function handleCancel() {
    setSaveErrors(null);
    exitEditMode();
  }

  const mapScrollTopRef = useRef(0);
  const handleMapScroll = useCallback((scrollTop: number) => {
    mapScrollTopRef.current = scrollTop;
  }, []);

  const hasOffsets = registers.some((r) => r.offset != null);

  function handleNavigateToRegister(registerId: string) {
    dispatch({ type: 'SET_ACTIVE_REGISTER', registerId });
    setActiveTab('register');
  }

  // Editor takes over the full panel — no tab bar
  if (isEditing && activeDraft) {
    return (
      <main className="flex-1 overflow-y-auto p-4">
        <RegisterEditor
          draft={activeDraft}
          onDraftChange={handleDraftChange}
          onSave={handleSave}
          onCancel={handleCancel}
          saveErrors={saveErrors}
        />
      </main>
    );
  }

  const tabBar = hasOffsets && (
    <div className="flex border-b border-gray-200 dark:border-gray-700 px-4 shrink-0">
      {(['register', 'map'] as const).map((tab) => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className={`px-3 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors
            ${activeTab === tab
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
        >
          {tab === 'register' ? 'Register' : 'Map'}
        </button>
      ))}
    </div>
  );

  if (activeTab === 'map' && hasOffsets) {
    return (
      <main className="flex-1 flex flex-col overflow-hidden">
        {tabBar}
        <RegisterMapView
          registers={registers}
          onNavigateToRegister={handleNavigateToRegister}
          scrollTopRef={mapScrollTopRef}
          onScrollChange={handleMapScroll}
        />
      </main>
    );
  }

  if (!activeRegister) {
    return (
      <main className="flex-1 flex flex-col overflow-hidden">
        {tabBar}
        <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-500">
          <div className="text-center">
            <p className="text-lg mb-2">No register selected</p>
            <p className="text-sm">Add a register from the sidebar to get started.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      {tabBar}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="bg-white dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold">{activeRegister.name}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {activeRegister.offset != null && <><span className="font-mono">{formatOffset(activeRegister.offset)}</span>{' · '}</>}
                <span className="font-mono">{activeRegister.width}</span>-bit register
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
          <BitGrid register={activeRegister} hoveredFieldIndices={hoveredFieldIndices} onFieldHover={setHoveredFieldIndices} fieldHoverSets={fieldHoverSets} />
        </div>
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2 mt-6">
          Field Breakdown
        </h3>
        <FieldTable register={activeRegister} hoveredFieldIndices={hoveredFieldIndices} onFieldHover={setHoveredFieldIndices} fieldHoverSets={fieldHoverSets} />
      </div>
    </main>
  );
}
