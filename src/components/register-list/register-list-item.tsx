import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RegisterDef } from '../../types/register';
import { formatOffset } from '../../utils/format';

interface Props {
  register: RegisterDef;
  isActive: boolean;
  hasPendingEdit: boolean;
  hasOverlapWarning?: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function GripIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="currentColor"
      className={className}
    >
      <circle cx="5" cy="3" r="1.5" />
      <circle cx="11" cy="3" r="1.5" />
      <circle cx="5" cy="8" r="1.5" />
      <circle cx="11" cy="8" r="1.5" />
      <circle cx="5" cy="13" r="1.5" />
      <circle cx="11" cy="13" r="1.5" />
    </svg>
  );
}

export function RegisterListItem({ register, isActive, hasPendingEdit, hasOverlapWarning = false, onSelect, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: register.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  if (confirming) {
    return (
      <li
        ref={setNodeRef}
        style={style}
        className="flex items-center justify-between px-3 py-2 rounded-md text-sm
          bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
      >
        <div className="flex items-center gap-2">
          <button
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab touch-none text-gray-400 dark:text-gray-500"
            tabIndex={-1}
          >
            <GripIcon />
          </button>
          <span className="text-red-700 dark:text-red-300 truncate">Delete?</span>
        </div>
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
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`group relative flex items-stretch gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors ${
        isActive
          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200'
          : 'hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
      }`}
    >
      {/* Grip handle — spans full item height */}
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="cursor-grab touch-none self-stretch flex items-center text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 shrink-0"
        title="Drag to reorder"
        tabIndex={-1}
      >
        <GripIcon />
      </button>

      {/* Content column */}
      <div className="flex-1 min-w-0">
        {/* Line 1: name */}
        <div className="truncate font-medium pr-6">{register.name}</div>

        {/* Line 2: offset + indicators | width badge */}
        <div className="flex items-center justify-between mt-0.5 pr-6">
          <div className="flex items-center gap-1.5">
            {register.offset != null && (
              <span className="text-xs font-mono text-gray-500 dark:text-gray-500">
                {formatOffset(register.offset)}
              </span>
            )}
            {hasPendingEdit && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />
            )}
            {hasOverlapWarning && (
              <svg
                viewBox="0 0 16 16"
                width="12"
                height="12"
                fill="currentColor"
                className="text-amber-500 shrink-0"
                role="img"
                aria-label="Overlap warning"
              >
                <path d="M8.94 1.5a1.09 1.09 0 0 0-1.88 0L1.18 13.04A1.09 1.09 0 0 0 2.12 14.5h11.76a1.09 1.09 0 0 0 .94-1.46L8.94 1.5zM7.25 6h1.5v3.5h-1.5V6zm0 4.5h1.5V12h-1.5v-1.5z" />
              </svg>
            )}
          </div>
          <span className="text-xs font-mono text-gray-500 dark:text-gray-500 shrink-0">
            {register.width}b
          </span>
        </div>
      </div>

      {/* Delete button — visible on hover or keyboard focus */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100
          text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-opacity"
        title="Delete register"
      >
        &times;
      </button>
    </li>
  );
}
