import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { AppProvider } from './app-context';
import { useAppState } from './app-context';
import { ProjectStorageProvider, useProjectStorageActions, useProjectStorage } from './project-storage-context';
import { EditProvider } from './edit-context';
import {
  createProject,
  loadProject,
  loadManifest,
  patchProjectState,
  invalidateManifestCache,
} from '../utils/project-storage';
import { serializeState, EMPTY_SERIALIZED_STATE } from '../utils/storage';
import { SAVE_DEBOUNCE_MS } from '../constants';

// ─── Minimal autosave harness ────────────────────────────────────────────────
//
// This intentionally mirrors the PRE-guard AppShellInner debounced-autosave
// effect: after SAVE_DEBOUNCE_MS it writes whatever in-memory state exists to
// whatever the current activeLocalId is.  That is exactly the seam that
// corrupted the survivor project before the deleteLocalProject fix.

function AutosaveHarness() {
  const state = useAppState();
  const { activeLocalId, isUnsaved } = useProjectStorage();
  useEffect(() => {
    if (!activeLocalId && !isUnsaved) return;
    const timer = setTimeout(() => {
      if (activeLocalId) patchProjectState(activeLocalId, serializeState(state));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state, activeLocalId, isUnsaved]);
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeStateWithTitle(title: string) {
  return { ...EMPTY_SERIALIZED_STATE, project: { ...EMPTY_SERIALIZED_STATE.project, title } };
}

function makeWrapper(initialLocalId: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProvider>
        <EditProvider>
          <ProjectStorageProvider initialLocalId={initialLocalId}>
            <AutosaveHarness />
            {children}
          </ProjectStorageProvider>
        </EditProvider>
      </AppProvider>
    );
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('delete active project (integration, real storage)', () => {
  beforeEach(() => {
    localStorage.clear();
    invalidateManifestCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounced autosave does not overwrite the fallback project when the active project is deleted', async () => {
    // Seed two REAL projects with DISTINCT state so corruption is detectable.
    const fallbackId = createProject(makeStateWithTitle('Survivor'), 'Survivor');
    const activeId = createProject(makeStateWithTitle('Doomed'), 'Doomed');

    const { result } = renderHook(() => useProjectStorageActions(), {
      wrapper: makeWrapper(activeId),
    });

    // Let any initial debounce fire and settle, then snapshot the survivor's
    // distinguishable content (title).  We use title — not byte-identical JSON —
    // because patchProjectState legitimately updates localSavedAt and may
    // reorder keys even for an uncorrupted write.
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 50);
    });
    const survivorTitleBefore = loadProject(fallbackId)?.state?.project?.title;
    expect(survivorTitleBefore).toBe('Survivor'); // sanity-check the seed

    // Delete the active (doomed) project.
    act(() => { result.current.deleteLocalProject(activeId); });

    // Advance past the debounce window so any rogue autosave would fire.
    await act(async () => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 50);
    });

    // The deleted project is gone.
    expect(loadProject(activeId)).toBeNull();

    // The survivor's state title must NOT have been overwritten with the doomed
    // project's title ('Doomed') — that is the exact corruption the fix prevents.
    const survivorAfter = loadProject(fallbackId);
    expect(survivorAfter).not.toBeNull();
    expect(survivorAfter?.state?.project?.title).toBe('Survivor');

    // The manifest contains only the fallback.
    expect(loadManifest().projects.map((p) => p.localId)).toEqual([fallbackId]);
  });
});
