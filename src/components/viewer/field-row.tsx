import { useState, useEffect, useRef } from 'react';
import type { Field } from '../../types/register';
import type { DecodedValue } from '../../types/register';
import { extractBits } from '../../utils/bitwise';
import { encodeField } from '../../utils/encode';
import { formatDecodedValue } from '../../utils/decode';
import { validateFieldInput } from '../../utils/validation';
import { useAppDispatch } from '../../context/app-context';
import { fieldColor, fieldBorderColor } from '../../utils/field-colors';

interface Props {
  field: Field;
  fieldIndex: number;
  registerId: string;
  registerValue: bigint;
  registerWidth: number;
  decoded: DecodedValue;
  isHighlighted: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function FieldRow({ field, fieldIndex, registerId, registerValue, registerWidth, decoded, isHighlighted, onMouseEnter, onMouseLeave }: Props) {
  const dispatch = useAppDispatch();
  const rawBits = extractBits(registerValue, field.msb, field.lsb);
  const bitWidth = field.msb - field.lsb + 1;
  const binaryStr = rawBits.toString(2).padStart(bitWidth, '0');
  const bitsLabel = field.msb === field.lsb ? `[${field.msb}]` : `[${field.msb}:${field.lsb}]`;
  const mask = ((1n << BigInt(bitWidth)) - 1n) << BigInt(field.lsb);
  const maskStr = '0x' + mask.toString(16).toUpperCase().padStart(Math.ceil(registerWidth / 4), '0');
  const borderColor = fieldBorderColor(fieldIndex);
  const tintBg = fieldColor(fieldIndex, 0.06);
  const highlightBg = fieldColor(fieldIndex, 0.15);

  // Controlled input state for numeric field types
  const isFocusedRef = useRef(false);
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const displayStr = formatDecodedValue(decoded);

  // Sync input text from external changes (bit grid, hex input, field definition edits)
  // but only when this input is not focused — same pattern as ValueInputBar.
  useEffect(() => {
    if (!isFocusedRef.current) {
      setInputText(displayStr);
      setError(null);
    }
  }, [displayStr]);

  // Reset focus ref if field type changes to a non-text-input type
  useEffect(() => {
    if (field.type === 'flag' || field.type === 'enum') {
      isFocusedRef.current = false;
    }
  }, [field.type]);

  function handleFieldEdit(input: string | number | boolean) {
    try {
      const newBits = encodeField(input, field);
      dispatch({ type: 'SET_FIELD_VALUE', registerId, field, rawBits: newBits });
    } catch {
      // Silently discard (flag/enum paths — these don't throw in practice)
    }
  }

  function handleInputChange(text: string) {
    setInputText(text);
    setError(validateFieldInput(text, field.type));
  }

  function handleInputBlur() {
    isFocusedRef.current = false;
    // Re-validate to avoid stale error state from React batching
    const freshError = validateFieldInput(inputText, field.type);
    if (freshError !== null) {
      setInputText(displayStr);
      setError(null);
      return;
    }
    try {
      const newBits = encodeField(inputText, field);
      dispatch({ type: 'SET_FIELD_VALUE', registerId, field, rawBits: newBits });
    } catch {
      setInputText(displayStr);
    }
    setError(null);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === 'Escape') {
      setInputText(displayStr);
      setError(null);
      (e.target as HTMLInputElement).blur();
    }
  }

  function renderValueControl() {
    switch (field.type) {
      case 'flag': {
        const isSet = decoded.type === 'flag' && decoded.value;
        const label = isSet
          ? (field.flagLabels?.set ?? 'set')
          : (field.flagLabels?.clear ?? 'clear');
        return (
          <button
            type="button"
            onClick={() => handleFieldEdit(!isSet)}
            className={`px-2 py-0.5 text-sm font-mono rounded cursor-pointer select-none transition-colors ${
              isSet
                ? 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-800/40'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
            }`}
          >
            {label}
          </button>
        );
      }

      case 'enum':
        return (
          <select
            value={decoded.type === 'enum' ? decoded.value : 0}
            onChange={(e) => handleFieldEdit(e.target.value)}
            className="max-w-full px-1.5 py-0.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {field.enumEntries.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.name} ({entry.value})
              </option>
            ))}
            {decoded.type === 'enum' && decoded.name === null && (
              <option value={decoded.value}>
                Unknown ({decoded.value})
              </option>
            )}
          </select>
        );

      case 'integer':
      case 'float':
      case 'fixed-point': {
        const hasError = error !== null;
        return (
          <div className="relative group/field-input inline-block w-32">
            <input
              type="text"
              value={inputText}
              onFocus={() => { isFocusedRef.current = true; }}
              onChange={(e) => handleInputChange(e.target.value)}
              onBlur={handleInputBlur}
              onKeyDown={handleInputKeyDown}
              className={`w-full px-1.5 py-0.5 text-sm rounded border font-mono bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 ${
                hasError
                  ? 'border-red-500 dark:border-red-400 focus:ring-red-500'
                  : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500'
              }`}
              spellCheck={false}
              aria-invalid={hasError}
            />
            {hasError && (
              <div
                role="tooltip"
                className="absolute bottom-full left-0 mb-1 z-50 hidden group-focus-within/field-input:block px-2 py-1 text-xs rounded bg-red-600 text-white whitespace-nowrap shadow-md pointer-events-none"
              >
                {error}
              </div>
            )}
          </div>
        );
      }
    }
  }

  return (
    <tr
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="border-b border-gray-200 dark:border-gray-700 transition-colors duration-150 motion-reduce:transition-none"
      style={{ backgroundColor: isHighlighted ? highlightBg : tintBg }}
    >
      <td className="px-3 py-2 text-sm font-medium truncate" title={field.name} style={{ borderLeft: `4px solid ${borderColor}` }}>
        {field.name}
      </td>
      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 font-mono truncate" title={bitsLabel}>
        {bitsLabel}
      </td>
      <td className="px-3 py-2 text-sm font-mono text-gray-500 dark:text-gray-400 truncate" title={maskStr}>
        {maskStr}
      </td>
      <td className="px-3 py-2 text-sm font-mono text-gray-600 dark:text-gray-300 truncate" title={binaryStr}>
        {binaryStr}
      </td>
      <td className="px-3 py-2 text-sm overflow-visible">
        {renderValueControl()}
      </td>
      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 truncate hidden lg:table-cell" title={field.description ?? ''}>
        {field.description}
      </td>
    </tr>
  );
}
