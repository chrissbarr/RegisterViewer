import { renderHook, act } from '@testing-library/react';
import { EditProvider, useEditState, useEditActions } from './edit-context';
import { makeRegister } from '../test/helpers';
import type { ReactNode } from 'react';

function wrapper({ children }: { children: ReactNode }) {
  return <EditProvider>{children}</EditProvider>;
}

function renderEditHooks() {
  return renderHook(
    () => ({ ...useEditState(), ...useEditActions() }),
    { wrapper },
  );
}

describe('useEditState outside provider', () => {
  it('throws when used outside EditProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useEditState())).toThrow(
      'useEditState must be used within EditProvider',
    );
    spy.mockRestore();
  });
});

describe('useEditActions outside provider', () => {
  it('throws when used outside EditProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useEditActions())).toThrow(
      'useEditActions must be used within EditProvider',
    );
    spy.mockRestore();
  });
});

describe('initial state', () => {
  it('starts with empty drafts and not editing', () => {
    const { result } = renderEditHooks();
    expect(result.current.drafts).toEqual({});
    expect(result.current.dirtyDraftIds.size).toBe(0);
    expect(result.current.dirtyCount).toBe(0);
    expect(result.current.isEditing).toBe(false);
  });
});

describe('enterEditMode / exitEditMode', () => {
  it('sets isEditing to true and populates the draft', () => {
    const { result } = renderEditHooks();
    const reg = makeRegister({ id: 'reg-1', name: 'REG' });

    act(() => result.current.enterEditMode(reg));

    expect(result.current.isEditing).toBe(true);
    expect(result.current.getDraft('reg-1')).toBeDefined();
    expect(result.current.getDraft('reg-1')!.name).toBe('REG');
  });

  it('does not overwrite an existing draft for the same register', () => {
    const { result } = renderEditHooks();
    const reg = makeRegister({ id: 'reg-1', name: 'REG' });

    act(() => result.current.enterEditMode(reg));
    act(() =>
      result.current.setDraft('reg-1', { ...reg, name: 'MODIFIED' }),
    );
    // Re-entering edit mode with the original should NOT overwrite the modified draft
    act(() => result.current.enterEditMode(reg));

    expect(result.current.getDraft('reg-1')!.name).toBe('MODIFIED');
  });

  it('exitEditMode clears all drafts and sets isEditing to false', () => {
    const { result } = renderEditHooks();
    const reg = makeRegister({ id: 'reg-1' });

    act(() => result.current.enterEditMode(reg));
    expect(result.current.isEditing).toBe(true);

    act(() => result.current.exitEditMode());
    expect(result.current.isEditing).toBe(false);
    expect(result.current.drafts).toEqual({});
  });
});

describe('getDraft / setDraft', () => {
  it('returns undefined for a non-existent draft', () => {
    const { result } = renderEditHooks();
    expect(result.current.getDraft('nonexistent')).toBeUndefined();
  });

  it('setDraft updates the draft in state', () => {
    const { result } = renderEditHooks();
    const reg = makeRegister({ id: 'reg-1', name: 'ORIGINAL' });

    act(() => result.current.enterEditMode(reg));
    act(() =>
      result.current.setDraft('reg-1', { ...reg, name: 'UPDATED' }),
    );

    expect(result.current.getDraft('reg-1')!.name).toBe('UPDATED');
  });
});

describe('dirtyDraftIds / dirtyCount', () => {
  it('draft is not dirty when unchanged from original', () => {
    const { result } = renderEditHooks();
    const reg = makeRegister({ id: 'reg-1', name: 'REG' });

    act(() => result.current.enterEditMode(reg));

    expect(result.current.dirtyDraftIds.has('reg-1')).toBe(false);
    expect(result.current.dirtyCount).toBe(0);
  });

  it('draft becomes dirty after modification', () => {
    const { result } = renderEditHooks();
    const reg = makeRegister({ id: 'reg-1', name: 'REG' });

    act(() => result.current.enterEditMode(reg));
    act(() =>
      result.current.setDraft('reg-1', { ...reg, name: 'CHANGED' }),
    );

    expect(result.current.dirtyDraftIds.has('reg-1')).toBe(true);
    expect(result.current.dirtyCount).toBe(1);
  });
});

describe('saveAllDrafts', () => {
  it('returns all drafts and clears state', () => {
    const { result } = renderEditHooks();
    const reg1 = makeRegister({ id: 'reg-1', name: 'A' });
    const reg2 = makeRegister({ id: 'reg-2', name: 'B' });

    act(() => result.current.enterEditMode(reg1));
    act(() => result.current.enterEditMode(reg2));

    let all: ReturnType<typeof result.current.saveAllDrafts>;
    act(() => {
      all = result.current.saveAllDrafts();
    });

    expect(all!).toHaveLength(2);
    expect(result.current.isEditing).toBe(false);
    expect(result.current.drafts).toEqual({});
  });
});
