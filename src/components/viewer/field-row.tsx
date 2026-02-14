import type { Field } from '../../types/register';
import type { DecodedValue } from '../../types/register';
import { extractBits } from '../../utils/bitwise';
import { encodeField } from '../../utils/encode';
import { useAppDispatch } from '../../context/app-context';
import { FIELD_BORDER_COLORS } from './bit-grid';

interface Props {
  field: Field;
  fieldIndex: number;
  registerId: string;
  registerValue: bigint;
  registerWidth: number;
  decoded: DecodedValue;
}

export function FieldRow({ field, fieldIndex, registerId, registerValue, registerWidth, decoded }: Props) {
  const dispatch = useAppDispatch();
  const rawBits = extractBits(registerValue, field.msb, field.lsb);
  const bitWidth = field.msb - field.lsb + 1;
  const binaryStr = rawBits.toString(2).padStart(bitWidth, '0');
  const bitsLabel = field.msb === field.lsb ? `[${field.msb}]` : `[${field.msb}:${field.lsb}]`;
  const mask = ((1n << BigInt(bitWidth)) - 1n) << BigInt(field.lsb);
  const maskStr = '0x' + mask.toString(16).toUpperCase().padStart(Math.ceil(registerWidth / 4), '0');
  const borderColor = FIELD_BORDER_COLORS[fieldIndex % FIELD_BORDER_COLORS.length];

  function handleFieldEdit(input: string | number | boolean) {
    try {
      const newBits = encodeField(input, field);
      dispatch({ type: 'SET_FIELD_VALUE', registerId, field, rawBits: newBits });
    } catch {
      // Silently discard invalid input (e.g. empty string for integer fields)
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
            {field.enumEntries?.map((entry) => (
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
        const displayVal = decoded.type === 'integer'
          ? decoded.value.toString()
          : decoded.type === 'float'
            ? (Number.isNaN(decoded.value) ? 'NaN' : decoded.value.toString())
            : decoded.value.toString();

        return (
          <input
            type="text"
            defaultValue={displayVal}
            onBlur={(e) => handleFieldEdit(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-32 px-1.5 py-0.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            key={registerValue.toString()}
          />
        );
      }
    }
  }

  return (
    <tr className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <td className="px-3 py-2 text-sm font-medium truncate" title={field.name} style={{ borderLeft: `3px solid ${borderColor}` }}>
        {field.name}
      </td>
      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 font-mono">
        {bitsLabel}
      </td>
      <td className="px-3 py-2 text-sm font-mono text-gray-500 dark:text-gray-400">
        {maskStr}
      </td>
      <td className="px-3 py-2 text-sm font-mono text-gray-600 dark:text-gray-300">
        {binaryStr}
      </td>
      <td className="px-3 py-2 text-sm">
        {renderValueControl()}
      </td>
      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 truncate hidden lg:table-cell" title={field.description ?? ''}>
        {field.description}
      </td>
    </tr>
  );
}
