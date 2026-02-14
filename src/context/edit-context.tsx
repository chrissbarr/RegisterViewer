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
  saveDraft: (id: string) => RegisterDef | undefined;
  discardDraft: (id: string) => void;
  saveAllDrafts: () => RegisterDef[];
  discardAllDrafts: () => void;
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

  const saveDraft = useCallback((id: string): RegisterDef | undefined => {
    const draft = drafts[id];
    if (draft) {
      setDrafts((prev) => {
        const { [id]: _, ...rest } = prev;
        void _;
        if (Object.keys(rest).length === 0) setIsEditing(false);
        return rest;
      });
      setOriginals((prev) => {
        const { [id]: _, ...rest } = prev;
        void _;
        return rest;
      });
    }
    return draft;
  }, [drafts]);

  const discardDraft = useCallback((id: string) => {
    setDrafts((prev) => {
      const { [id]: _, ...rest } = prev;
      void _;
      if (Object.keys(rest).length === 0) setIsEditing(false);
      return rest;
    });
    setOriginals((prev) => {
      const { [id]: _, ...rest } = prev;
      void _;
      return rest;
    });
  }, []);

  const saveAllDrafts = useCallback((): RegisterDef[] => {
    const all = Object.values(drafts);
    setDrafts({});
    setOriginals({});
    setIsEditing(false);
    return all;
  }, [drafts]);

  const discardAllDrafts = useCallback(() => {
    setDrafts({});
    setOriginals({});
    setIsEditing(false);
  }, []);

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
        saveDraft,
        discardDraft,
        saveAllDrafts,
        discardAllDrafts,
      }}
    >
      {children}
    </EditContext.Provider>
  );
}

export function useEditContext() {
  const ctx = useContext(EditContext);
  if (!ctx) throw new Error('useEditContext must be used within EditProvider');
  return ctx;
}
