import { useState } from 'react';
import type { Field, FieldDraft, FieldType, EnumEntry, QFormat, Signedness } from '../../types/register';
import { toField, toFieldDraft } from '../../types/register';
import { inputClass, inputClassSans, selectClass } from './editor-styles';

interface Props {
  field: Field;
  regWidth: number;
  onUpdate: (field: Field) => void;
  onDelete: () => void;
  onDone: () => void;
}

export function FieldDefinitionForm({ field, regWidth, onUpdate, onDelete, onDone }: Props) {
  const [draft, setDraft] = useState<FieldDraft>(() => toFieldDraft(field));
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function update(partial: Partial<FieldDraft>) {
    const updated = { ...draft, ...partial };
    setDraft(updated);
    onUpdate(toField(updated));
  }

  function handleTypeChange(type: FieldType) {
    // Start with base properties, stripping all type-specific props
    const clean: FieldDraft = {
      id: draft.id,
      name: draft.name,
      description: draft.description,
      msb: draft.msb,
      lsb: draft.lsb,
      type,
    };
    // Set sensible defaults for the new type
    if (type === 'flag') {
      clean.msb = draft.lsb; // force 1-bit
      clean.flagLabels = draft.flagLabels ?? { clear: 'clear', set: 'set' };
    } else if (type === 'enum') {
      clean.enumEntries = draft.enumEntries?.length ? draft.enumEntries : [{ value: 0, name: 'VALUE_0' }];
    } else if (type === 'integer') {
      clean.signedness = draft.signedness;
    } else if (type === 'float') {
      clean.floatType = draft.floatType ?? 'single';
    } else if (type === 'fixed-point') {
      const bitWidth = draft.msb - draft.lsb + 1;
      clean.qFormat = draft.qFormat ?? { m: Math.ceil(bitWidth / 2), n: Math.floor(bitWidth / 2) };
    }
    setDraft(clean);
    onUpdate(toField(clean));
  }

  function addEnumEntry() {
    const entries = [...(draft.enumEntries ?? [])];
    const nextVal = entries.length > 0 ? Math.max(...entries.map((e) => e.value)) + 1 : 0;
    entries.push({ value: nextVal, name: `VALUE_${nextVal}` });
    update({ enumEntries: entries });
  }

  function updateEnumEntry(index: number, entry: EnumEntry) {
    const entries = [...(draft.enumEntries ?? [])];
    entries[index] = entry;
    update({ enumEntries: entries });
  }

  function deleteEnumEntry(index: number) {
    const entries = [...(draft.enumEntries ?? [])];
    entries.splice(index, 1);
    update({ enumEntries: entries });
  }

  return (
    <div className="p-3 rounded border-2 border-blue-400 dark:border-blue-600 bg-gray-50 dark:bg-gray-800/50 space-y-3">
      {/* Row 1: Name, Type */}
      <div className="grid grid-cols-4 gap-2">
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">Name</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Type</span>
          <select
            value={draft.type}
            onChange={(e) => handleTypeChange(e.target.value as FieldType)}
            className={selectClass}
          >
            <option value="flag">Flag</option>
            <option value="enum">Enum</option>
            <option value="integer">Integer</option>
            <option value="float">Float</option>
            <option value="fixed-point">Fixed-Point</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Bits</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={draft.msb}
              min={0}
              max={regWidth - 1}
              onChange={(e) => update({ msb: parseInt(e.target.value) || 0 })}
              className={inputClass + ' w-14'}
              title="MSB"
            />
            <span className="text-gray-400">:</span>
            <input
              type="number"
              value={draft.lsb}
              min={0}
              max={regWidth - 1}
              onChange={(e) => update({ lsb: parseInt(e.target.value) || 0 })}
              className={inputClass + ' w-14'}
              title="LSB"
            />
          </div>
        </label>
      </div>

      {/* Description */}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-gray-500 dark:text-gray-400">Description (optional)</span>
        <input
          type="text"
          value={draft.description ?? ''}
          onChange={(e) => update({ description: e.target.value || undefined })}
          className={inputClassSans}
        />
      </label>

      {/* Type-specific options */}
      {draft.type === 'flag' && (
        <div className="flex items-center gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Label when 0</span>
            <input
              type="text"
              value={draft.flagLabels?.clear ?? 'clear'}
              onChange={(e) => update({ flagLabels: { clear: e.target.value, set: draft.flagLabels?.set ?? 'set' } })}
              className={inputClassSans + ' w-32'}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Label when 1</span>
            <input
              type="text"
              value={draft.flagLabels?.set ?? 'set'}
              onChange={(e) => update({ flagLabels: { clear: draft.flagLabels?.clear ?? 'clear', set: e.target.value } })}
              className={inputClassSans + ' w-32'}
            />
          </label>
        </div>
      )}

      {draft.type === 'integer' && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Signedness</span>
          <select
            value={draft.signedness ?? 'unsigned'}
            onChange={(e) => {
              const val = e.target.value as Signedness;
              update({ signedness: val === 'unsigned' ? undefined : val });
            }}
            className={selectClass + ' w-48'}
          >
            <option value="unsigned">Unsigned</option>
            <option value="twos-complement">Two's Complement</option>
            <option value="sign-magnitude">Sign-Magnitude</option>
          </select>
        </label>
      )}

      {draft.type === 'float' && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Float precision</span>
          <select
            value={draft.floatType ?? 'single'}
            onChange={(e) => update({ floatType: e.target.value as 'half' | 'single' | 'double' })}
            className={selectClass + ' w-40'}
          >
            <option value="half">Half (16-bit)</option>
            <option value="single">Single (32-bit)</option>
            <option value="double">Double (64-bit)</option>
          </select>
        </label>
      )}

      {draft.type === 'fixed-point' && (
        <div className="flex items-center gap-2">
          <span className="text-sm">Q</span>
          <input
            type="number"
            value={draft.qFormat?.m ?? 8}
            min={0}
            onChange={(e) =>
              update({
                qFormat: { m: parseInt(e.target.value) || 0, n: draft.qFormat?.n ?? 8 } as QFormat,
              })
            }
            className={inputClass + ' w-14'}
            title="Integer bits (m)"
          />
          <span className="text-sm">.</span>
          <input
            type="number"
            value={draft.qFormat?.n ?? 8}
            min={0}
            onChange={(e) =>
              update({
                qFormat: { m: draft.qFormat?.m ?? 8, n: parseInt(e.target.value) || 0 } as QFormat,
              })
            }
            className={inputClass + ' w-14'}
            title="Fractional bits (n)"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
            Total: {(draft.qFormat?.m ?? 8) + (draft.qFormat?.n ?? 8)} bits
          </span>
        </div>
      )}

      {draft.type === 'enum' && (
        <div>
          <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Enum values</span>
          <div className="space-y-1 mb-2">
            {(draft.enumEntries ?? []).map((entry, i) => (
              <div key={entry.value} className="flex items-center gap-2">
                <input
                  type="number"
                  value={entry.value}
                  onChange={(e) =>
                    updateEnumEntry(i, { ...entry, value: parseInt(e.target.value) || 0 })
                  }
                  className={inputClass + ' w-16'}
                  title="Value"
                />
                <input
                  type="text"
                  value={entry.name}
                  onChange={(e) => updateEnumEntry(i, { ...entry, name: e.target.value })}
                  className={inputClass + ' flex-1'}
                  title="Name"
                />
                <button
                  onClick={() => deleteEnumEntry(i)}
                  className="text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addEnumEntry}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            + Add value
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
        {confirmingDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-red-600 dark:text-red-400">Delete?</span>
            <button
              onClick={onDelete}
              className="px-2 py-0.5 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingDelete(true)}
            className="text-sm text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
          >
            Delete field
          </button>
        )}
        <button
          onClick={onDone}
          className="px-3 py-1 rounded text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
