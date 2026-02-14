import { useAppState, useAppDispatch } from '../../context/app-context';
import { useEditContext } from '../../context/edit-context';
import { RegisterListItem } from './register-list-item';

export function RegisterList() {
  const { registers, activeRegisterId } = useAppState();
  const dispatch = useAppDispatch();
  const { dirtyDraftIds } = useEditContext();

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

  return (
    <div className="flex-1 overflow-y-auto">
      <ul className="p-2 space-y-1">
        {registers.map((reg) => (
          <RegisterListItem
            key={reg.id}
            register={reg}
            isActive={reg.id === activeRegisterId}
            hasPendingEdit={dirtyDraftIds.has(reg.id)}
            onSelect={() => dispatch({ type: 'SET_ACTIVE_REGISTER', registerId: reg.id })}
            onDelete={() => dispatch({ type: 'DELETE_REGISTER', registerId: reg.id })}
          />
        ))}
      </ul>
      <div className="p-2">
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
      </div>
    </div>
  );
}
