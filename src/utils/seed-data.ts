import type { RegisterDef } from '../types/register';

/** Example registers to seed the app on first launch. */
export function createSeedRegisters(): RegisterDef[] {
  return [
    {
      id: crypto.randomUUID(),
      name: 'STATUS_REG',
      description: 'Example: device status register',
      width: 32,
      offset: 0x00,
      fields: [
        {
          id: crypto.randomUUID(),
          name: 'ENABLE',
          description: 'Device enable flag',
          msb: 0,
          lsb: 0,
          type: 'flag',
        },
        {
          id: crypto.randomUUID(),
          name: 'READY',
          description: 'Device ready flag',
          msb: 1,
          lsb: 1,
          type: 'flag',
        },
        {
          id: crypto.randomUUID(),
          name: 'MODE',
          description: 'Operating mode',
          msb: 4,
          lsb: 2,
          type: 'enum',
          enumEntries: [
            { value: 0, name: 'IDLE' },
            { value: 1, name: 'RUN' },
            { value: 2, name: 'SLEEP' },
            { value: 3, name: 'STANDBY' },
            { value: 4, name: 'TEST' },
          ],
        },
        {
          id: crypto.randomUUID(),
          name: 'ERROR_CODE',
          description: 'Last error code',
          msb: 11,
          lsb: 8,
          type: 'integer',
          signedness: 'unsigned',
        },
        {
          id: crypto.randomUUID(),
          name: 'TEMPERATURE',
          description: 'Temperature reading (signed)',
          msb: 23,
          lsb: 16,
          type: 'integer',
          signedness: 'twos-complement',
        },
        {
          id: crypto.randomUUID(),
          name: 'GAIN',
          description: 'Gain coefficient (Q4.4 fixed-point)',
          msb: 31,
          lsb: 24,
          type: 'fixed-point',
          qFormat: { m: 4, n: 4 },
        },
      ],
    },
  ];
}
