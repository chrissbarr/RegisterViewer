import { RegisterList } from '../register-list/register-list';

export function Sidebar() {
  return (
    <aside className="w-56 border-r border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex flex-col">
      <div className="p-3 border-b border-gray-300 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
          Registers
        </h2>
      </div>
      <RegisterList />
    </aside>
  );
}
