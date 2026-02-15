import { useState } from 'react';
import type { RegisterDef } from '../../types/register';

function stripIdsFromRegister(register: RegisterDef) {
  const { id: _regId, fields, ...rest } = register;
  void _regId;
  const cleanFields = fields.map(({ id: _fieldId, ...fieldRest }) => {
    void _fieldId;
    return fieldRest;
  });
  return { ...rest, fields: cleanFields };
}

interface Props {
  register: RegisterDef;
  onUpdate: (register: RegisterDef) => void;
}

export function JsonConfigEditor({ register, onUpdate }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [prevRegister, setPrevRegister] = useState(register);
  if (register !== prevRegister) {
    setPrevRegister(register);
    setText(JSON.stringify(stripIdsFromRegister(register), null, 2));
    setError(null);
  }

  function handleApply() {
    try {
      const parsed = JSON.parse(text) as RegisterDef;
      if (!parsed.name || !parsed.width || !Array.isArray(parsed.fields)) {
        setError('Invalid register definition: must have name, width, and fields array');
        return;
      }
      // Ensure all fields have IDs
      for (const field of parsed.fields) {
        if (!field.id) field.id = crypto.randomUUID();
      }
      if (!parsed.id) parsed.id = register.id;
      setError(null);
      onUpdate(parsed);
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
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
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
