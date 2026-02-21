import type { RegisterDef } from '../../types/register';
import { GripIcon } from './register-list-item';
import { formatOffset } from '../../utils/format';

interface Props {
  register: RegisterDef;
  isActive: boolean;
  hasPendingEdit: boolean;
  offsetDigits?: number;
}

export function RegisterListItemOverlay({ register, isActive, hasPendingEdit, offsetDigits }: Props) {
  return (
    <li
      className={`relative flex items-stretch gap-2 px-3 py-2 rounded-md text-sm shadow-lg ring-2 ring-blue-500/50 list-none ${
        isActive
          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200'
          : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300'
      }`}
    >
      {/* Grip handle — spans full item height */}
      <span className="self-stretch flex items-center text-gray-400 dark:text-gray-500 shrink-0">
        <GripIcon />
      </span>

      {/* Content column */}
      <div className="flex-1 min-w-0">
        {/* Line 1: name */}
        <div className="truncate font-medium pr-6">{register.name}</div>

        {/* Line 2: offset + indicators | width badge */}
        <div className="flex items-center justify-between mt-0.5 pr-6">
          <div className="flex items-center gap-1.5">
            {register.offset != null && (
              <span className="text-xs font-mono text-gray-500 dark:text-gray-500">
                {formatOffset(register.offset, offsetDigits)}
              </span>
            )}
            {hasPendingEdit && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />
            )}
          </div>
          <span className="text-xs font-mono text-gray-500 dark:text-gray-500 shrink-0">
            {register.width}b
          </span>
        </div>
      </div>

      <span className="absolute top-2 right-2 text-gray-400">&times;</span>
    </li>
  );
}
