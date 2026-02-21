import { AppProvider } from './context/app-context';
import { AppShell } from './components/layout/app-shell';
import { loadFromLocalStorage } from './utils/storage';
import { createSeedRegisters } from './utils/seed-data';
import { SIDEBAR_WIDTH_DEFAULT, type AppState } from './types/register';

function getInitialState(): AppState | undefined {
  const saved = loadFromLocalStorage();
  if (saved) return saved;

  // First launch: seed with example register
  const seedRegisters = createSeedRegisters();
  const seedValues: Record<string, bigint> = {};
  for (const reg of seedRegisters) {
    seedValues[reg.id] = 0xDEADBEEFn; // fun default value
  }
  return {
    registers: seedRegisters,
    activeRegisterId: seedRegisters[0]?.id ?? null,
    registerValues: seedValues,
    theme: 'dark',
    project: {
      title: 'Example Project',
      description: 'Demonstrates register field types. Open Project Settings from the menu to customize.',
    },
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    sidebarCollapsed: false,
    mapTableWidth: 32,
    mapShowGaps: true,
  };
}

const initialState = getInitialState();

export default function App() {
  return (
    <AppProvider savedState={initialState}>
      <AppShell />
    </AppProvider>
  );
}
