import { useAppState, useAppDispatch } from '../../context/app-context';

export function ThemeToggle() {
  const { theme } = useAppState();
  const dispatch = useAppDispatch();

  return (
    <button
      onClick={() => dispatch({ type: 'TOGGLE_THEME' })}
      className="px-3 py-1.5 rounded-md text-sm font-medium
        bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200
        hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}
