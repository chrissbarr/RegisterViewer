import { ChevronLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { RegisterList } from '../register-list/register-list';

interface Props {
  width: number;
  collapsed: boolean;
  isResizing: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ width, collapsed, isResizing, onToggleCollapse }: Props) {
  // Disable animation during drag-to-resize for 1:1 cursor tracking
  const widthTransition = isResizing
    ? { duration: 0 }
    : { duration: 0.2, ease: 'easeInOut' as const };

  return (
    <motion.aside
      animate={{
        width: collapsed ? 0 : width,
        minWidth: collapsed ? 0 : width,
      }}
      transition={widthTransition}
      className="border-r border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex flex-col overflow-hidden"
    >
      <motion.div
        animate={{ opacity: collapsed ? 0 : 1 }}
        transition={{ duration: collapsed ? 0.1 : 0.15, delay: collapsed ? 0 : 0.1 }}
        className="flex flex-col flex-1 overflow-hidden"
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
            <ChevronLeft size={12} />
          </button>
        </div>
        <RegisterList />
      </motion.div>
    </motion.aside>
  );
}
