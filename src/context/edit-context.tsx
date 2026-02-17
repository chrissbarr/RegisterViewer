import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { RegisterDef } from '../types/register';

function registersEqual(a: RegisterDef, b: RegisterDef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface EditContextValue {
  drafts: Record<string, RegisterDef>;
  dirtyDraftIds: Set<string>;
  dirtyCount: number;
  isEditing: boolean;
  enterEditMode: (register: RegisterDef) => void;
  exitEditMode: () => void;
  getDraft: (id: string) => RegisterDef | undefined;
  setDraft: (id: string, draft: RegisterDef) => void;
  saveAllDrafts: () => RegisterDef[];
}

const EditContext = createContext<EditContextValue | null>(null);

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

  return (
    <EditContext.Provider
      value={{
        drafts,
        dirtyDraftIds,
        dirtyCount,
        isEditing,
        enterEditMode,
        exitEditMode,
        getDraft,
        setDraft,
        saveAllDrafts,
      }}
    >
      {children}
    </EditContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useEditContext() {
  const ctx = useContext(EditContext);
  if (!ctx) throw new Error('useEditContext must be used within EditProvider');
  return ctx;
}
