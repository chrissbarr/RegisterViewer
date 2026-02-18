import { AppProvider } from './context/app-context';
import { AppShell } from './components/layout/app-shell';
import { loadFromLocalStorage } from './utils/storage';
import { createSeedRegisters } from './utils/seed-data';
import type { AppState } from './types/register';

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
