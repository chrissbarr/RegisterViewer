import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useAppState, useAppDispatch } from '../../context/app-context';
import { useEditContext } from '../../context/edit-context';
import { RegisterListItem } from './register-list-item';
import { RegisterListItemOverlay } from './register-list-item-overlay';

export function RegisterList() {
  const { registers, activeRegisterId } = useAppState();
  const dispatch = useAppDispatch();
  const { isEditing, enterEditMode, dirtyDraftIds } = useEditContext();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = registers.findIndex((r) => r.id === active.id);
    const newIndex = registers.findIndex((r) => r.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      dispatch({ type: 'REORDER_REGISTERS', oldIndex, newIndex });
    }
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  function handleAdd() {
    const id = crypto.randomUUID();
    dispatch({
      type: 'ADD_REGISTER',
      register: {
        id,
        name: `REG_${registers.length}`,
        width: 32,
        fields: [],
      },
    });
  }

  const activeRegister = activeId ? registers.find((r) => r.id === activeId) : null;

  return (
    <div className="flex-1 overflow-y-auto">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={registers.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ul className="p-2 space-y-1">
            {registers.map((reg) => (
              <RegisterListItem
                key={reg.id}
                register={reg}
                isActive={reg.id === activeRegisterId}
                hasPendingEdit={dirtyDraftIds.has(reg.id)}
                onSelect={() => {
                  dispatch({ type: 'SET_ACTIVE_REGISTER', registerId: reg.id });
                  if (isEditing) enterEditMode(reg);
                }}
                onDelete={() => dispatch({ type: 'DELETE_REGISTER', registerId: reg.id })}
              />
            ))}
          </ul>
        </SortableContext>
        <DragOverlay>
          {activeRegister ? (
            <RegisterListItemOverlay
              register={activeRegister}
              isActive={activeRegister.id === activeRegisterId}
              hasPendingEdit={dirtyDraftIds.has(activeRegister.id)}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      <div className="p-2 space-y-1">
        <button
          onClick={handleAdd}
          className="w-full px-3 py-1.5 rounded-md text-sm font-medium
            border border-dashed border-gray-400 dark:border-gray-600
            text-gray-600 dark:text-gray-400
            hover:border-blue-500 hover:text-blue-500 dark:hover:border-blue-400 dark:hover:text-blue-400
            transition-colors"
        >
          + Add Register
        </button>
        <button
          onClick={() => dispatch({ type: 'SORT_REGISTERS_BY_OFFSET' })}
          disabled={!registers.some((r) => r.offset != null)}
          className="w-full px-3 py-1.5 rounded-md text-sm font-medium
            border border-gray-300 dark:border-gray-600
            text-gray-600 dark:text-gray-400
            hover:border-blue-500 hover:text-blue-500 dark:hover:border-blue-400 dark:hover:text-blue-400
            disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-300 disabled:hover:text-gray-600
            dark:disabled:hover:border-gray-600 dark:disabled:hover:text-gray-400
            transition-colors"
        >
          Sort by Offset
        </button>
      </div>
    </div>
  );
}
