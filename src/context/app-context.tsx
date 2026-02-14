import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import type { AppState, RegisterDef, Field } from '../types/register';
import { replaceBits, toggleBit } from '../utils/bitwise';

// --- Actions ---

export type Action =
  | { type: 'SET_REGISTER_VALUE'; registerId: string; value: bigint }
  | { type: 'TOGGLE_BIT'; registerId: string; bit: number }
  | { type: 'SET_FIELD_VALUE'; registerId: string; field: Field; rawBits: bigint }
  | { type: 'ADD_REGISTER'; register: RegisterDef }
  | { type: 'UPDATE_REGISTER'; register: RegisterDef }
  | { type: 'DELETE_REGISTER'; registerId: string }
  | { type: 'SET_ACTIVE_REGISTER'; registerId: string }
  | { type: 'TOGGLE_THEME' }
  | { type: 'IMPORT_REGISTERS'; registers: RegisterDef[] }
  | { type: 'LOAD_STATE'; state: AppState }
  | { type: 'REORDER_REGISTERS'; oldIndex: number; newIndex: number };

// --- Reducer ---

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_REGISTER_VALUE': {
      return {
        ...state,
        registerValues: { ...state.registerValues, [action.registerId]: action.value },
      };
    }
    case 'TOGGLE_BIT': {
      const current = state.registerValues[action.registerId] ?? 0n;
      return {
        ...state,
        registerValues: {
          ...state.registerValues,
          [action.registerId]: toggleBit(current, action.bit),
        },
      };
    }
    case 'SET_FIELD_VALUE': {
      const current = state.registerValues[action.registerId] ?? 0n;
      const updated = replaceBits(current, action.field.msb, action.field.lsb, action.rawBits);
      return {
        ...state,
        registerValues: { ...state.registerValues, [action.registerId]: updated },
      };
    }
    case 'ADD_REGISTER': {
      return {
        ...state,
        registers: [...state.registers, action.register],
        activeRegisterId: action.register.id,
        registerValues: { ...state.registerValues, [action.register.id]: 0n },
      };
    }
    case 'UPDATE_REGISTER': {
      return {
        ...state,
        registers: state.registers.map((r) =>
          r.id === action.register.id ? action.register : r
        ),
      };
    }
    case 'DELETE_REGISTER': {
      const remaining = state.registers.filter((r) => r.id !== action.registerId);
      const { [action.registerId]: _, ...remainingValues } = state.registerValues;
      void _;
      return {
        ...state,
        registers: remaining,
        registerValues: remainingValues,
        activeRegisterId:
          state.activeRegisterId === action.registerId
            ? (remaining[0]?.id ?? null)
            : state.activeRegisterId,
      };
    }
    case 'SET_ACTIVE_REGISTER': {
      return { ...state, activeRegisterId: action.registerId };
    }
    case 'TOGGLE_THEME': {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      return { ...state, theme: next };
    }
    case 'IMPORT_REGISTERS': {
      const newValues: Record<string, bigint> = {};
      for (const r of action.registers) {
        newValues[r.id] = state.registerValues[r.id] ?? 0n;
      }
      return {
        ...state,
        registers: action.registers,
        registerValues: newValues,
        activeRegisterId: action.registers[0]?.id ?? null,
      };
    }
    case 'LOAD_STATE': {
      return action.state;
    }
    case 'REORDER_REGISTERS': {
      return { ...state, registers: arrayMove(state.registers, action.oldIndex, action.newIndex) };
    }
    default:
      return state;
  }
}

// --- Context ---

const initialState: AppState = {
  registers: [],
  activeRegisterId: null,
  registerValues: {},
  theme: 'dark',
};

const AppStateContext = createContext<AppState | null>(null);
const AppDispatchContext = createContext<Dispatch<Action> | null>(null);

export function AppProvider({ children, savedState }: { children: ReactNode; savedState?: AppState }) {
  const [state, dispatch] = useReducer(appReducer, savedState ?? initialState);
  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}

export function useAppDispatch() {
  const ctx = useContext(AppDispatchContext);
  if (!ctx) throw new Error('useAppDispatch must be used within AppProvider');
  return ctx;
}
