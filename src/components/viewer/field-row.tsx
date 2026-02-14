import type { Field } from '../../types/register';
import type { DecodedValue } from '../../types/register';
import { extractBits } from '../../utils/bitwise';
import { formatDecodedValue } from '../../utils/decode';
import { encodeField } from '../../utils/encode';
import { useAppDispatch } from '../../context/app-context';
import { FIELD_BORDER_COLORS } from './bit-grid';

interface Props {
  field: Field;
  fieldIndex: number;
  registerId: string;
  registerValue: bigint;
  decoded: DecodedValue;
}

export function FieldRow({ field, fieldIndex, registerId, registerValue, decoded }: Props) {
  const dispatch = useAppDispatch();
  const rawBits = extractBits(registerValue, field.msb, field.lsb);
  const bitWidth = field.msb - field.lsb + 1;
  const binaryStr = rawBits.toString(2).padStart(bitWidth, '0');
  const bitsLabel = field.msb === field.lsb ? `[${field.msb}]` : `[${field.msb}:${field.lsb}]`;
  const borderColor = FIELD_BORDER_COLORS[fieldIndex % FIELD_BORDER_COLORS.length];

  function handleFieldEdit(input: string | number | boolean) {
    const newBits = encodeField(input, field);
    dispatch({ type: 'SET_FIELD_VALUE', registerId, field, rawBits: newBits });
  }

  function renderEditControl() {
    switch (field.type) {
      case 'flag':
        return (
          <input
            type="checkbox"
            checked={decoded.type === 'flag' && decoded.value}
            onChange={(e) => handleFieldEdit(e.target.checked)}
            className="w-4 h-4 accent-blue-500"
          />
        );

      case 'enum':
        return (
          <select
            value={decoded.type === 'enum' ? decoded.value : 0}
            onChange={(e) => handleFieldEdit(e.target.value)}
            className="px-1.5 py-0.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {field.enumEntries?.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.name} ({entry.value})
              </option>
            ))}
            {/* If current value isn't in the enum, show it as unknown */}
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
            className="w-28 px-1.5 py-0.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
            key={registerValue.toString()} // reset when external value changes
          />
        );
      }
    }
  }

  return (
    <tr className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <td className="px-3 py-2 text-sm font-medium" style={{ borderLeft: `3px solid ${borderColor}` }}>
        {field.name}
      </td>
      <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 font-mono">
        {bitsLabel}
      </td>
      <td className="px-3 py-2 text-sm font-mono text-gray-600 dark:text-gray-300">
        {binaryStr}
      </td>
      <td className="px-3 py-2 text-sm font-mono">
        {formatDecodedValue(decoded)}
      </td>
      <td className="px-3 py-2 text-sm">
        {renderEditControl()}
      </td>
    </tr>
  );
}
