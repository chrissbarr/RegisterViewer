import { useState } from 'react';
import type { ProjectMetadata } from '../../types/register';
import { useAppState, useAppDispatch } from '../../context/app-context';
import { sanitizeProjectMetadata } from '../../utils/storage';
import { Dialog } from './dialog';

interface ProjectSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const inputClass =
  'w-full px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500';

export function ProjectSettingsDialog({ open, onClose }: ProjectSettingsDialogProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const [draft, setDraft] = useState<ProjectMetadata>({});
  const [wasOpen, setWasOpen] = useState(false);

  if (open && !wasOpen) {
    setDraft(state.project ?? {});
    setWasOpen(true);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  function update(partial: Partial<ProjectMetadata>) {
    setDraft((prev) => ({ ...prev, ...partial }));
  }

  function handleSave() {
    dispatch({
      type: 'SET_PROJECT_METADATA',
      project: sanitizeProjectMetadata(draft),
    });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Project Settings">
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Title
          </span>
          <input
            type="text"
            value={draft.title ?? ''}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="e.g. ATmega328P Register Map"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Description
          </span>
          <textarea
            value={draft.description ?? ''}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Brief description of this register set"
            rows={2}
            className={inputClass + ' resize-y'}
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Address unit size
          </span>
          <select
            value={state.addressUnitBits}
            onChange={(e) =>
              dispatch({ type: 'SET_ADDRESS_UNIT_BITS', addressUnitBits: Number(e.target.value) })
            }
            className={inputClass}
          >
            <option value={8}>8-bit</option>
            <option value={16}>16-bit</option>
            <option value={32}>32-bit</option>
            <option value={64}>64-bit</option>
            <option value={128}>128-bit</option>
          </select>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            How many bits each address offset increment represents.
          </p>
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Date
          </span>
          <input
            type="text"
            value={draft.date ?? ''}
            onChange={(e) => update({ date: e.target.value })}
            placeholder="e.g. 2026-02-18"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Author email
          </span>
          <input
            type="email"
            value={draft.authorEmail ?? ''}
            onChange={(e) => update({ authorEmail: e.target.value })}
            placeholder="e.g. name@example.com"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Link
          </span>
          <input
            type="url"
            value={draft.link ?? ''}
            onChange={(e) => update({ link: e.target.value })}
            placeholder="e.g. https://example.com/datasheet.pdf"
            className={inputClass}
          />
        </label>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}
