import { useState } from 'react';
import type { RegisterDef } from '../../types/register';

interface Props {
  register: RegisterDef;
  isActive: boolean;
  hasPendingEdit: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function RegisterListItem({ register, isActive, hasPendingEdit, onSelect, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <li
        className="flex items-center justify-between px-3 py-2 rounded-md text-sm
          bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
      >
        <span className="text-red-700 dark:text-red-300 truncate">Delete?</span>
        <div className="flex gap-1 shrink-0 ml-2">
          <button
            onClick={() => { onDelete(); setConfirming(false); }}
            className="px-2 py-0.5 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            Yes
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            No
          </button>
        </div>
      </li>
    );
  }

  return (
    <li
      onClick={onSelect}
      className={`flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm transition-colors ${
        isActive
          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200'
          : 'hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {hasPendingEdit && (
          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />
        )}
        <span className="truncate font-medium">{register.name}</span>
        <span className="text-xs text-gray-500 dark:text-gray-500 shrink-0">
          {register.width}b
        </span>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
        className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 ml-2 shrink-0"
        title="Delete register"
      >
        &times;
      </button>
    </li>
  );
}
