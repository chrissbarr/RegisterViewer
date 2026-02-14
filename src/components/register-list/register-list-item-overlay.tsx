import type { RegisterDef } from '../../types/register';
import { GripIcon } from './register-list-item';

interface Props {
  register: RegisterDef;
  isActive: boolean;
  hasPendingEdit: boolean;
}

export function RegisterListItemOverlay({ register, isActive, hasPendingEdit }: Props) {
  return (
    <li
      className={`flex items-center justify-between px-3 py-2 rounded-md text-sm shadow-lg ring-2 ring-blue-500/50 list-none ${
        isActive
          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200'
          : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-gray-400 dark:text-gray-500 shrink-0">
          <GripIcon />
        </span>
        {hasPendingEdit && (
          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />
        )}
        <span className="truncate font-medium">{register.name}</span>
        <span className="text-xs text-gray-500 dark:text-gray-500 shrink-0">
          {register.width}b
        </span>
      </div>
      <span className="text-gray-400 ml-2 shrink-0">&times;</span>
    </li>
  );
}
