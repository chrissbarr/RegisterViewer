import { useMemo, useState } from 'react';
import type { RegisterDef, Field, FlagField } from '../../types/register';
import { useEditContext } from '../../context/edit-context';
import { FieldDefinitionForm } from './field-definition-form';
import { JsonConfigEditor } from './json-config-editor';
import { formatOffset } from '../../utils/format';
import { MAX_REGISTER_WIDTH, getFieldWarnings } from '../../utils/validation';
import { inputClass, inputClassSans } from './editor-styles';

interface Props {
  draft: RegisterDef;
  onDraftChange: (draft: RegisterDef) => void;
  onSave: () => void;
  onCancel: () => void;
  saveErrors?: string[] | null;
}

type EditorTab = 'gui' | 'json';

export function RegisterEditor({
  draft,
  onDraftChange,
  onSave,
  onCancel,
  saveErrors,
}: Props) {
  const { dirtyCount } = useEditContext();
  const [tab, setTab] = useState<EditorTab>('gui');
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [confirmingDeleteFieldId, setConfirmingDeleteFieldId] = useState<string | null>(null);
  const [widthText, setWidthText] = useState(String(draft.width));
  const [offsetText, setOffsetText] = useState(
    draft.offset != null ? formatOffset(draft.offset) : ''
  );
  const [prevDraftKey, setPrevDraftKey] = useState(`${draft.id}:${draft.width}:${draft.offset}`);
  const draftKey = `${draft.id}:${draft.width}:${draft.offset}`;
  if (draftKey !== prevDraftKey) {
    setPrevDraftKey(draftKey);
    setWidthText(String(draft.width));
    setOffsetText(draft.offset != null ? formatOffset(draft.offset) : '');
  }

  function updateMeta(partial: Partial<Pick<RegisterDef, 'name' | 'description' | 'width' | 'offset'>>) {
    onDraftChange({ ...draft, ...partial });
  }

  function addField() {
    const id = crypto.randomUUID();
    const nextLsb = draft.fields.length > 0
      ? Math.max(...draft.fields.map((f) => f.msb)) + 1
      : 0;
    const newField: FlagField = {
      id,
      name: `FIELD_${draft.fields.length}`,
      msb: Math.min(nextLsb, draft.width - 1),
      lsb: Math.min(nextLsb, draft.width - 1),
      type: 'flag',
    };
    onDraftChange({ ...draft, fields: [...draft.fields, newField] });
    setEditingFieldId(id);
  }

  function updateField(updated: Field) {
    onDraftChange({
      ...draft,
      fields: draft.fields.map((f) => (f.id === updated.id ? updated : f)),
    });
  }

  function deleteField(fieldId: string) {
    onDraftChange({
      ...draft,
      fields: draft.fields.filter((f) => f.id !== fieldId),
    });
    if (editingFieldId === fieldId) setEditingFieldId(null);
  }

  const widthParsed = parseInt(widthText, 10);
  const widthHasError = widthText.trim() !== '' && (!Number.isInteger(widthParsed) || widthParsed < 1 || widthParsed > MAX_REGISTER_WIDTH);

  const fieldWarnings = useMemo(() => getFieldWarnings(draft), [draft]);
  const warningsByFieldId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const w of fieldWarnings) {
      for (const id of w.fieldIds) {
        const existing = map.get(id);
        if (existing) existing.push(w.message);
        else map.set(id, [w.message]);
      }
    }
    return map;
  }, [fieldWarnings]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Edit Register</h2>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-sm font-medium
              bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200
              hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            className="px-3 py-1.5 rounded-md text-sm font-medium
              bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      {dirtyCount > 1 && (
        <div className="mb-3 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-300">
          {dirtyCount} registers with unsaved changes
        </div>
      )}

      {saveErrors && saveErrors.length > 0 && (
        <div className="mb-3 px-3 py-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 space-y-1">
          {saveErrors.map((err, i) => (
            <p key={i}>{err}</p>
          ))}
        </div>
      )}

      {/* Register metadata */}
      <div className="grid grid-cols-3 gap-3 mb-2">
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
          <div className="relative group/width-input">
            <input
              type="text"
              inputMode="numeric"
              value={widthText}
              onChange={(e) => setWidthText(e.target.value)}
              onBlur={() => {
                const val = parseInt(widthText, 10);
                if (Number.isInteger(val) && val >= 1 && val <= MAX_REGISTER_WIDTH) {
                  updateMeta({ width: val });
                  setWidthText(String(val));
                } else {
                  setWidthText(String(draft.width));
                }
              }}
              className={`${inputClass} w-full ${
                widthHasError
                  ? 'border-red-500 dark:border-red-400 focus:ring-red-500'
                  : ''
              }`}
              aria-invalid={widthHasError}
            />
            {widthHasError && (
              <div
                role="tooltip"
                className="absolute bottom-full left-0 mb-1 z-50 hidden group-focus-within/width-input:block px-2 py-1 text-xs rounded bg-red-600 text-white whitespace-nowrap shadow-md pointer-events-none"
              >
                Must be 1–{MAX_REGISTER_WIDTH}
              </div>
            )}
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Offset</span>
          <input
            type="text"
            value={offsetText}
            placeholder="e.g. 0x04"
            onChange={(e) => setOffsetText(e.target.value)}
            onBlur={() => {
              const raw = offsetText.trim();
              if (raw === '' || raw === '0x' || raw === '0X') {
                updateMeta({ offset: undefined });
                setOffsetText('');
              } else {
                const parsed = parseInt(raw, raw.startsWith('0x') || raw.startsWith('0X') ? 16 : 10);
                if (!isNaN(parsed) && parsed >= 0) {
                  updateMeta({ offset: parsed });
                  setOffsetText(formatOffset(parsed));
                } else {
                  setOffsetText(draft.offset != null ? formatOffset(draft.offset) : '');
                }
              }
            }}
            className={inputClass}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 mb-4">
        <span className="text-xs text-gray-500 dark:text-gray-400">Description</span>
        <input
          type="text"
          value={draft.description ?? ''}
          onChange={(e) => updateMeta({ description: e.target.value || undefined })}
          className={inputClassSans}
        />
      </label>

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
          {fieldWarnings.length > 0 && (
            <div className="mb-3 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-300 space-y-1">
              {fieldWarnings.map((w, i) => <p key={i}>⚠ {w.message}</p>)}
            </div>
          )}
          {/* Field list */}
          <div className="space-y-2 mb-3">
            {[...draft.fields].sort((a, b) => b.msb - a.msb).map((field) => (
              <div key={field.id}>
                {editingFieldId === field.id ? (
                  <FieldDefinitionForm
                    field={field}
                    regWidth={draft.width}
                    onUpdate={updateField}
                    onDelete={() => deleteField(field.id)}
                    onDone={() => setEditingFieldId(null)}
                  />
                ) : confirmingDeleteFieldId === field.id ? (
                  <div className="flex items-center justify-between px-3 py-2 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
                    <span className="text-sm text-red-700 dark:text-red-300">Delete {field.name}?</span>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button
                        onClick={() => { deleteField(field.id); setConfirmingDeleteFieldId(null); }}
                        className="px-2 py-0.5 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmingDeleteFieldId(null)}
                        className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                      >
                        No
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => setEditingFieldId(field.id)}
                    className={`flex items-center justify-between px-3 py-2 rounded border hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer ${
                      warningsByFieldId.has(field.id)
                        ? 'border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/10'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-medium text-sm">{field.name}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        [{field.msb === field.lsb ? field.msb : `${field.msb}:${field.lsb}`}]
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        {field.type}
                      </span>
                      {warningsByFieldId.has(field.id) && (() => {
                        const msgs = warningsByFieldId.get(field.id)!;
                        return (
                          <span className="text-xs text-amber-600 dark:text-amber-400 truncate" title={msgs.join('; ')}>
                            ⚠ {msgs[0]}{msgs.length > 1 ? ` (+${msgs.length - 1} more)` : ''}
                          </span>
                        );
                      })()}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmingDeleteFieldId(field.id); }}
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
        <JsonConfigEditor register={draft} onUpdate={onDraftChange} />
      )}
    </div>
  );
}
