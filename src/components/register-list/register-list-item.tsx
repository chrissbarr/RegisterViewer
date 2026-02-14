import type { RegisterDef } from '../../types/register';

interface Props {
  register: RegisterDef;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function RegisterListItem({ register, isActive, onSelect, onDelete }: Props) {
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
        <span className="truncate font-medium">{register.name}</span>
        <span className="text-xs text-gray-500 dark:text-gray-500 shrink-0">
          {register.width}b
        </span>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 ml-2 shrink-0"
        title="Delete register"
      >
        &times;
      </button>
    </li>
  );
}
