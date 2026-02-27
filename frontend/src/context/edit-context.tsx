import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { RegisterDef } from '../types/register';
import { registersEqual } from '../utils/register-equality';

interface EditState {
  drafts: Record<string, RegisterDef>;
  dirtyDraftIds: Set<string>;
  dirtyCount: number;
  isEditing: boolean;
}

interface EditActions {
  enterEditMode: (register: RegisterDef) => void;
  exitEditMode: () => void;
  getDraft: (id: string) => RegisterDef | undefined;
  setDraft: (id: string, draft: RegisterDef) => void;
  saveAllDrafts: () => RegisterDef[];
}

const EditStateContext = createContext<EditState | null>(null);
const EditActionsContext = createContext<EditActions | null>(null);

export function EditProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Record<string, RegisterDef>>({});
  const [originals, setOriginals] = useState<Record<string, RegisterDef>>({});
  const [isEditing, setIsEditing] = useState(false);

  const dirtyDraftIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of Object.keys(drafts)) {
      if (!originals[id] || !registersEqual(drafts[id], originals[id])) {
        ids.add(id);
      }
    }
    return ids;
  }, [drafts, originals]);

  const dirtyCount = dirtyDraftIds.size;

  const enterEditMode = useCallback((register: RegisterDef) => {
    setIsEditing(true);
    setDrafts((prev) => {
      if (prev[register.id]) return prev;
      return { ...prev, [register.id]: structuredClone(register) };
    });
    setOriginals((prev) => {
      if (prev[register.id]) return prev;
      return { ...prev, [register.id]: structuredClone(register) };
    });
  }, []);

  const exitEditMode = useCallback(() => {
    setIsEditing(false);
    setDrafts({});
    setOriginals({});
  }, []);

  const getDraft = useCallback(
    (id: string) => drafts[id],
    [drafts],
  );

  const setDraft = useCallback((id: string, draft: RegisterDef) => {
    setDrafts((prev) => ({ ...prev, [id]: draft }));
  }, []);

  const saveAllDrafts = useCallback((): RegisterDef[] => {
    const all = Object.values(drafts);
    setDrafts({});
    setOriginals({});
    setIsEditing(false);
    return all;
  }, [drafts]);

  const state = useMemo<EditState>(
    () => ({ drafts, dirtyDraftIds, dirtyCount, isEditing }),
    [drafts, dirtyDraftIds, dirtyCount, isEditing],
  );

  const actions = useMemo<EditActions>(
    () => ({ enterEditMode, exitEditMode, getDraft, setDraft, saveAllDrafts }),
    [enterEditMode, exitEditMode, getDraft, setDraft, saveAllDrafts],
  );

  return (
    <EditStateContext.Provider value={state}>
      <EditActionsContext.Provider value={actions}>
        {children}
      </EditActionsContext.Provider>
    </EditStateContext.Provider>
  );
}

export function useEditState(): EditState {
  const ctx = useContext(EditStateContext);
  if (!ctx) throw new Error('useEditState must be used within EditProvider');
  return ctx;
}

export function useEditActions(): EditActions {
  const ctx = useContext(EditActionsContext);
  if (!ctx) throw new Error('useEditActions must be used within EditProvider');
  return ctx;
}