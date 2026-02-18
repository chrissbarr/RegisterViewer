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

interface ParsedExample {
  registers: unknown[];
  project?: { title?: string; description?: string };
}

function parseExample(raw: string): ParsedExample {
  return JSON.parse(raw) as ParsedExample;
}

function buildExample(id: string, raw: string, fallbackName: string): ExampleProject {
  const parsed = parseExample(raw);
  return {
    id,
    name: parsed.project?.title ?? fallbackName,
    description: parsed.project?.description ?? '',
    registerCount: parsed.registers.length,
    data: raw,
  };
}

export const examples: ExampleProject[] = [
  buildExample('all-field-types', allFieldTypesRaw, 'All Field Types'),
  buildExample('timer-counter', timerCounterRaw, 'Timer/Counter (ATmega328P)'),
  buildExample('atmega328p', atmega328pRaw, 'ATmega328P Full Register Map'),
];
