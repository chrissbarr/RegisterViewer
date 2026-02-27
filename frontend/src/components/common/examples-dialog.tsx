import { useState } from 'react';
import { Dialog } from './dialog';
import { examples, type ExampleProject } from '../../data/examples';

interface ExamplesDialogProps {
  open: boolean;
  onClose: () => void;
  onLoad: (jsonString: string) => void;
}

export function ExamplesDialog({ open, onClose, onLoad }: ExamplesDialogProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function handleClose() {
    setConfirmingId(null);
    onClose();
  }

  function handleSelect(example: ExampleProject) {
    setConfirmingId(example.id);
  }

  function handleConfirmLoad() {
    const example = examples.find(e => e.id === confirmingId);
    if (example) {
      onLoad(example.data);
      setConfirmingId(null);
      onClose();
    }
  }

  function handleCancelConfirm() {
    setConfirmingId(null);
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Example Projects">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Load an example project to explore. This will replace your current registers.
      </p>
      <ul className="space-y-2">
        {examples.map((example) => (
          <li key={example.id}>
            {confirmingId === example.id ? (
              <div className="p-3 rounded-lg border-2 border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/20">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
                  Replace current registers with &ldquo;{example.name}&rdquo;?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmLoad}
                    className="px-3 py-1.5 rounded-md text-sm font-medium
                      bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    Load
                  </button>
                  <button
                    onClick={handleCancelConfirm}
                    className="px-3 py-1.5 rounded-md text-sm font-medium
                      bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200
                      hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => handleSelect(example)}
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
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
