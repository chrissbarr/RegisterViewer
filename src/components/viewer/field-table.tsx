import type { RegisterDef } from '../../types/register';
import { useAppState } from '../../context/app-context';
import { decodeField } from '../../utils/decode';
import { FieldRow } from './field-row';

interface Props {
  register: RegisterDef;
  hoveredFieldIndex: number | null;
  onFieldHover: (index: number | null) => void;
}

export function FieldTable({ register, hoveredFieldIndex, onFieldHover }: Props) {
  const state = useAppState();
  const value = state.registerValues[register.id] ?? 0n;

  if (register.fields.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400 italic">
        No fields defined. Click "Edit" to add fields to this register.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left table-fixed min-w-[600px]">
        <thead>
          <tr className="border-b-2 border-gray-300 dark:border-gray-600">
            <th className="w-[15%] px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
            <th className="w-[7%] px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Bits</th>
            <th className="w-[11%] px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Mask</th>
            <th className="w-[13%] px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Binary</th>
            <th className="w-[18%] px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Value</th>
            <th className="w-[36%] px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase hidden lg:table-cell">Description</th>
          </tr>
        </thead>
        <tbody>
          {register.fields
            .map((field, i) => ({ field, originalIndex: i }))
            .sort((a, b) => b.field.msb - a.field.msb)
            .map(({ field, originalIndex }) => (
            <FieldRow
              key={field.id}
              field={field}
              fieldIndex={originalIndex}
              registerId={register.id}
              registerValue={value}
              registerWidth={register.width}
              decoded={decodeField(value, field)}
              isHighlighted={hoveredFieldIndex === originalIndex}
              onMouseEnter={() => onFieldHover(originalIndex)}
              onMouseLeave={() => onFieldHover(null)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
