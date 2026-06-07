import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { AppProvider } from './app-context';
import { ProjectStorageProvider, useProjectStorageActions } from './project-storage-context';
import { EditProvider } from './edit-context';
import {
  createProject,
  loadProject,
  loadManifest,
  invalidateManifestCache,
} from '../utils/project-storage';
import { EMPTY_SERIALIZED_STATE } from '../utils/storage';

function makeStateWithTitle(title: string) {
  return { ...EMPTY_SERIALIZED_STATE, project: { ...EMPTY_SERIALIZED_STATE.project, title } };
}

function makeWrapper(initialLocalId: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProvider>
        <EditProvider>
          <ProjectStorageProvider initialLocalId={initialLocalId}>
            {children}
          </ProjectStorageProvider>
        </EditProvider>
      </AppProvider>
    );
  };
}

describe('delete active project (integration, real storage)', () => {
  beforeEach(() => {
    localStorage.clear();
    invalidateManifestCache();
  });

  it('does not overwrite the fallback project when the active project is deleted', async () => {
    const fallbackId = createProject(makeStateWithTitle('Survivor'), 'Survivor');
    const activeId = createProject(makeStateWithTitle('Doomed'), 'Doomed');
    const survivorBefore = JSON.stringify(loadProject(fallbackId));

    const { result } = renderHook(() => useProjectStorageActions(), {
      wrapper: makeWrapper(activeId),
    });

    act(() => { result.current.deleteLocalProject(activeId); });

    // Let any debounced writes settle (AppShellInner is not rendered here,
    // but we verify the storage-layer invariant directly).
    await new Promise((r) => setTimeout(r, 400));

    // The deleted project is gone; the survivor's stored record is byte-identical.
    expect(loadProject(activeId)).toBeNull();
    expect(JSON.stringify(loadProject(fallbackId))).toBe(survivorBefore);
    expect(loadManifest().projects.map((p) => p.localId)).toEqual([fallbackId]);
  });
});
