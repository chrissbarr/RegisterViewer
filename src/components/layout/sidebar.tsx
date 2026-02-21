import { RegisterList } from '../register-list/register-list';

interface Props {
  width: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ width, collapsed, onToggleCollapse }: Props) {
  if (collapsed) return null;

  return (
    <aside
      style={{ width: `${width}px`, minWidth: `${width}px` }}
      className="border-r border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex flex-col overflow-hidden"
    >
      <div className="p-3 border-b border-gray-300 dark:border-gray-700 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
          Registers
        </h2>
        <button
          onClick={onToggleCollapse}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Collapse sidebar (Ctrl+B)"
          aria-label="Collapse sidebar"
        >
          <svg viewBox="0 0 8 12" width="8" height="12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="7,1 1,6 7,11" />
          </svg>
        </button>
      </div>
      <RegisterList />
    </aside>
  );
}
