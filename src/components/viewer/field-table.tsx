import type { RegisterDef } from '../../types/register';
import { useAppState } from '../../context/app-context';
import { decodeField } from '../../utils/decode';
import { FieldRow } from './field-row';

interface Props {
  register: RegisterDef;
}

export function FieldTable({ register }: Props) {
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
      <table className="w-full text-left">
        <thead>
          <tr className="border-b-2 border-gray-300 dark:border-gray-600">
            <th className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
            <th className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Bits</th>
            <th className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Binary</th>
            <th className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Value</th>
            <th className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Edit</th>
          </tr>
        </thead>
        <tbody>
          {register.fields.map((field, i) => (
            <FieldRow
              key={field.id}
              field={field}
              fieldIndex={i}
              registerId={register.id}
              registerValue={value}
              decoded={decodeField(value, field)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
