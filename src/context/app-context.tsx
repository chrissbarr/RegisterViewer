import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { SIDEBAR_WIDTH_DEFAULT, ADDRESS_UNIT_BITS_DEFAULT, ADDRESS_UNIT_BITS_VALUES, type AddressUnitBits, type AppState, type MapTableWidth, type RegisterDef, type Field, type ProjectMetadata } from '../types/register';

function isValidAddressUnitBits(n: number): n is AddressUnitBits {
  return (ADDRESS_UNIT_BITS_VALUES as readonly number[]).includes(n);
}
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
  | { type: 'IMPORT_STATE'; registers: RegisterDef[]; values: Record<string, bigint>; project?: ProjectMetadata; addressUnitBits?: AddressUnitBits }
  | { type: 'LOAD_STATE'; state: AppState }
  | { type: 'REORDER_REGISTERS'; oldIndex: number; newIndex: number }
  | { type: 'SORT_REGISTERS_BY_OFFSET' }
  | { type: 'CLEAR_WORKSPACE' }
  | { type: 'SET_PROJECT_METADATA'; project: ProjectMetadata | undefined }
  | { type: 'SET_SIDEBAR_WIDTH'; width: number }
  | { type: 'SET_SIDEBAR_COLLAPSED'; collapsed: boolean }
  | { type: 'SET_MAP_TABLE_WIDTH'; width: MapTableWidth }
  | { type: 'SET_MAP_SHOW_GAPS'; showGaps: boolean }
  | { type: 'SET_ADDRESS_UNIT_BITS'; addressUnitBits: number };

// --- Reducer ---

const MAP_TABLE_WIDTHS: MapTableWidth[] = [8, 16, 32];

/** Return the smallest valid MapTableWidth that is >= minBits. */
function clampMapTableWidth(minBits: number): MapTableWidth {
  return MAP_TABLE_WIDTHS.find((w) => w >= minBits) ?? 32;
}

// eslint-disable-next-line react-refresh/only-export-components
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
    case 'IMPORT_STATE': {
      const newValues: Record<string, bigint> = {};
      for (const r of action.registers) {
        newValues[r.id] = action.values[r.id] ?? 0n;
      }
      const importedBits = action.addressUnitBits ?? state.addressUnitBits;
      const importedTableWidth = state.mapTableWidth < importedBits
        ? clampMapTableWidth(importedBits)
        : state.mapTableWidth;
      return {
        ...state,
        registers: action.registers,
        registerValues: newValues,
        activeRegisterId: action.registers[0]?.id ?? null,
        project: action.project,
        addressUnitBits: importedBits,
        mapTableWidth: importedTableWidth,
      };
    }
    case 'LOAD_STATE': {
      return action.state;
    }
    case 'REORDER_REGISTERS': {
      return { ...state, registers: arrayMove(state.registers, action.oldIndex, action.newIndex) };
    }
    case 'SORT_REGISTERS_BY_OFFSET': {
      const sorted = [...state.registers].sort((a, b) => {
        if (a.offset == null && b.offset == null) return 0;
        if (a.offset == null) return 1;
        if (b.offset == null) return -1;
        return a.offset - b.offset;
      });
      return { ...state, registers: sorted };
    }
    case 'CLEAR_WORKSPACE': {
      return {
        ...state,
        registers: [],
        registerValues: {},
        activeRegisterId: null,
        project: undefined,
      };
    }
    case 'SET_PROJECT_METADATA': {
      return { ...state, project: action.project };
    }
    case 'SET_SIDEBAR_WIDTH': {
      return { ...state, sidebarWidth: action.width };
    }
    case 'SET_SIDEBAR_COLLAPSED': {
      return { ...state, sidebarCollapsed: action.collapsed };
    }
    case 'SET_MAP_TABLE_WIDTH': {
      return { ...state, mapTableWidth: action.width };
    }
    case 'SET_MAP_SHOW_GAPS': {
      return { ...state, mapShowGaps: action.showGaps };
    }
    case 'SET_ADDRESS_UNIT_BITS': {
      if (!isValidAddressUnitBits(action.addressUnitBits)) return state;
      const newBits = action.addressUnitBits;
      const clampedWidth = state.mapTableWidth < newBits
        ? clampMapTableWidth(newBits)
        : state.mapTableWidth;
      return { ...state, addressUnitBits: newBits, mapTableWidth: clampedWidth };
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
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  sidebarCollapsed: false,
  mapTableWidth: 32,
  mapShowGaps: true,
  addressUnitBits: ADDRESS_UNIT_BITS_DEFAULT,
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

// eslint-disable-next-line react-refresh/only-export-components
export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppDispatch() {
  const ctx = useContext(AppDispatchContext);
  if (!ctx) throw new Error('useAppDispatch must be used within AppProvider');
  return ctx;
}
