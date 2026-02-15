import allFieldTypesRaw from './all-field-types.json?raw';
import timerCounterRaw from './timer-counter.json?raw';
import atmega328pRaw from './atmega328p.json?raw';

export interface ExampleProject {
  id: string;
  name: string;
  description: string;
  registerCount: number;
  data: string; // raw JSON string for importFromJson()
}

function countRegisters(raw: string): number {
  return (JSON.parse(raw) as { registers: unknown[] }).registers.length;
}

export const examples: ExampleProject[] = [
  {
    id: 'all-field-types',
    name: 'All Field Types',
    description: 'Showcases all 5 field types: flag, enum, integer, float, and fixed-point across 7 registers.',
    registerCount: countRegisters(allFieldTypesRaw),
    data: allFieldTypesRaw,
  },
  {
    id: 'timer-counter',
    name: 'Timer/Counter (ATmega328P)',
    description: 'Timer/Counter0 and Timer/Counter1 registers from the ATmega328P microcontroller.',
    registerCount: countRegisters(timerCounterRaw),
    data: timerCounterRaw,
  },
  {
    id: 'atmega328p',
    name: 'ATmega328P Full Register Map',
    description: 'Complete I/O register map for the Atmel ATmega328P microcontroller with 87 registers.',
    registerCount: countRegisters(atmega328pRaw),
    data: atmega328pRaw,
  },
];
