import { useState } from 'react';
import type { RegisterDef } from '../../types/register';
import { sanitizeRegisterDef } from '../../utils/sanitize';
import { validateRegisterDef } from '../../utils/validation';
import { stripIds } from '../../utils/storage';

interface Props {
  register: RegisterDef;
  onUpdate: (register: RegisterDef) => void;
}

export function JsonConfigEditor({ register, onUpdate }: Props) {
  const [text, setText] = useState(() => JSON.stringify(stripIds(register), null, 2));
  const [error, setError] = useState<string | null>(null);
  const [prevRegister, setPrevRegister] = useState(register);
  if (register !== prevRegister) {
    setPrevRegister(register);
    setText(JSON.stringify(stripIds(register), null, 2));
    setError(null);
  }

  function handleApply() {
    try {
      const raw = JSON.parse(text);
      if (typeof raw !== 'object' || raw === null) {
        setError('JSON must be an object');
        return;
      }

      const sanitized = sanitizeRegisterDef(raw as Record<string, unknown>);

      // Preserve the register's existing id
      sanitized.id = register.id;

      const errors = validateRegisterDef(sanitized);
      if (errors.length > 0) {
        setError(errors.map((e) => e.message).join('\n'));
        return;
      }

      setError(null);
      onUpdate(sanitized);
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={20}
        spellCheck={false}
        className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
      />
      {error && (
        <div className="text-sm text-red-500 dark:text-red-400 space-y-1">
          {error.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      <button
        onClick={handleApply}
        className="px-3 py-1.5 rounded-md text-sm font-medium
          bg-blue-600 text-white hover:bg-blue-700 transition-colors"
      >
        Apply JSON
      </button>
    </div>
  );
}
