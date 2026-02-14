import { useState } from 'react';
import type { RegisterDef, Field, FieldType } from '../../types/register';
import { useAppDispatch } from '../../context/app-context';
import { FieldDefinitionForm } from './field-definition-form';
import { JsonConfigEditor } from './json-config-editor';

interface Props {
  register: RegisterDef;
  onClose: () => void;
}

type EditorTab = 'gui' | 'json';

export function RegisterEditor({ register, onClose }: Props) {
  const dispatch = useAppDispatch();
  const [draft, setDraft] = useState<RegisterDef>({ ...register, fields: [...register.fields] });
  const [tab, setTab] = useState<EditorTab>('gui');
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);

  function save() {
    dispatch({ type: 'UPDATE_REGISTER', register: draft });
    onClose();
  }

  function updateMeta(partial: Partial<Pick<RegisterDef, 'name' | 'description' | 'width'>>) {
    setDraft((d) => ({ ...d, ...partial }));
  }

  function addField() {
    const id = crypto.randomUUID();
    const nextLsb = draft.fields.length > 0
      ? Math.max(...draft.fields.map((f) => f.msb)) + 1
      : 0;
    const newField: Field = {
      id,
      name: `FIELD_${draft.fields.length}`,
      msb: Math.min(nextLsb, draft.width - 1),
      lsb: Math.min(nextLsb, draft.width - 1),
      type: 'flag' as FieldType,
    };
    setDraft((d) => ({ ...d, fields: [...d.fields, newField] }));
    setEditingFieldId(id);
  }

  function updateField(updated: Field) {
    setDraft((d) => ({
      ...d,
      fields: d.fields.map((f) => (f.id === updated.id ? updated : f)),
    }));
  }

  function deleteField(fieldId: string) {
    setDraft((d) => ({
      ...d,
      fields: d.fields.filter((f) => f.id !== fieldId),
    }));
    if (editingFieldId === fieldId) setEditingFieldId(null);
  }

  function handleJsonUpdate(updated: RegisterDef) {
    setDraft(updated);
  }

  const inputClass =
    'px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Edit Register</h2>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-sm font-medium
              bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200
              hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-3 py-1.5 rounded-md text-sm font-medium
              bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      {/* Register metadata */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Name</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => updateMeta({ name: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Width (bits)</span>
          <input
            type="number"
            value={draft.width}
            min={1}
            max={256}
            onChange={(e) => updateMeta({ width: parseInt(e.target.value) || 32 })}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Description</span>
          <input
            type="text"
            value={draft.description ?? ''}
            onChange={(e) => updateMeta({ description: e.target.value || undefined })}
            className={inputClass}
          />
        </label>
      </div>

      {/* Tab switch */}
      <div className="flex gap-1 mb-3 border-b border-gray-300 dark:border-gray-700">
        <button
          onClick={() => setTab('gui')}
          className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'gui'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Fields
        </button>
        <button
          onClick={() => setTab('json')}
          className={`px-3 py-1.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'json'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          JSON
        </button>
      </div>

      {tab === 'gui' ? (
        <div>
          {/* Field list */}
          <div className="space-y-2 mb-3">
            {draft.fields.map((field) => (
              <div key={field.id}>
                {editingFieldId === field.id ? (
                  <FieldDefinitionForm
                    field={field}
                    regWidth={draft.width}
                    onUpdate={updateField}
                    onDelete={() => deleteField(field.id)}
                    onDone={() => setEditingFieldId(null)}
                  />
                ) : (
                  <div
                    onClick={() => setEditingFieldId(field.id)}
                    className="flex items-center justify-between px-3 py-2 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-sm">{field.name}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        [{field.msb === field.lsb ? field.msb : `${field.msb}:${field.lsb}`}]
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        {field.type}
                      </span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteField(field.id); }}
                      className="text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                    >
                      &times;
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addField}
            className="px-3 py-1.5 rounded-md text-sm font-medium
              border border-dashed border-gray-400 dark:border-gray-600
              text-gray-600 dark:text-gray-400
              hover:border-blue-500 hover:text-blue-500 dark:hover:border-blue-400 dark:hover:text-blue-400
              transition-colors"
          >
            + Add Field
          </button>
        </div>
      ) : (
        <JsonConfigEditor register={draft} onUpdate={handleJsonUpdate} />
      )}
    </div>
  );
}
