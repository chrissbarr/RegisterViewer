import { Dialog } from './dialog';
import { examples } from '../../data/examples';

interface ExamplesDialogProps {
  open: boolean;
  onClose: () => void;
  onLoad: (jsonString: string, name: string) => void;
}

export function ExamplesDialog({ open, onClose, onLoad }: ExamplesDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Example Projects">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Load an example project to explore.
      </p>
      <ul className="space-y-2">
        {examples.map((example) => (
          <li key={example.id}>
            <button
              onClick={() => {
                onLoad(example.data, example.name);
              }}
              className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700
                hover:bg-gray-50 dark:hover:bg-gray-700/50
                hover:border-gray-300 dark:hover:border-gray-600
                transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{example.name}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {example.registerCount} registers
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {example.description}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
