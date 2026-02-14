import { useAppState, useAppDispatch } from '../../context/app-context';
import type { RegisterDef, Field } from '../../types/register';
import { getBit } from '../../utils/bitwise';

/** Color palette for fields — inline styles since TW v4 custom colors need dynamic application. */
const FIELD_COLORS = [
  'rgba(59,130,246,0.25)',   // blue
  'rgba(34,197,94,0.25)',    // green
  'rgba(245,158,11,0.25)',   // amber
  'rgba(244,63,94,0.25)',    // rose
  'rgba(168,85,247,0.25)',   // purple
  'rgba(6,182,212,0.25)',    // cyan
  'rgba(249,115,22,0.25)',   // orange
  'rgba(20,184,166,0.25)',   // teal
  'rgba(236,72,153,0.25)',   // pink
  'rgba(99,102,241,0.25)',   // indigo
];

const FIELD_BORDER_COLORS = [
  'rgb(59,130,246)',   // blue
  'rgb(34,197,94)',    // green
  'rgb(245,158,11)',   // amber
  'rgb(244,63,94)',    // rose
  'rgb(168,85,247)',   // purple
  'rgb(6,182,212)',    // cyan
  'rgb(249,115,22)',   // orange
  'rgb(20,184,166)',   // teal
  'rgb(236,72,153)',   // pink
  'rgb(99,102,241)',   // indigo
];

export { FIELD_COLORS, FIELD_BORDER_COLORS };

function getFieldForBit(bit: number, fields: Field[]): { field: Field; index: number } | null {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (bit >= f.lsb && bit <= f.msb) return { field: f, index: i };
  }
  return null;
}

interface Props {
  register: RegisterDef;
}

export function BitGrid({ register }: Props) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const value = state.registerValues[register.id] ?? 0n;

  // Render bits from MSB to LSB, grouped into 8-bit blocks
  const bits: number[] = [];
  for (let i = register.width - 1; i >= 0; i--) {
    bits.push(i);
  }

  // Group into 8-bit blocks
  const blocks: number[][] = [];
  for (let i = 0; i < bits.length; i += 8) {
    blocks.push(bits.slice(i, i + 8));
  }

  return (
    <div className="mb-4">
      <div className="flex flex-wrap gap-2">
        {blocks.map((block, blockIdx) => (
          <div key={blockIdx} className="flex gap-0">
            {block.map((bitIdx) => {
              const match = getFieldForBit(bitIdx, register.fields);
              const bgColor = match ? FIELD_COLORS[match.index % FIELD_COLORS.length] : undefined;
              const borderColor = match ? FIELD_BORDER_COLORS[match.index % FIELD_BORDER_COLORS.length] : undefined;

              return (
                <div
                  key={bitIdx}
                  onClick={() => dispatch({ type: 'TOGGLE_BIT', registerId: register.id, bit: bitIdx })}
                  title={match ? `Bit ${bitIdx} (${match.field.name})` : `Bit ${bitIdx}`}
                  className="flex flex-col items-center justify-center w-8 h-12 border border-gray-300 dark:border-gray-600 text-xs cursor-pointer hover:brightness-125 transition-all select-none"
                  style={{
                    backgroundColor: bgColor,
                    borderColor: borderColor,
                  }}
                >
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 leading-none">
                    {bitIdx}
                  </span>
                  <span className="font-bold text-sm leading-none mt-0.5">
                    {getBit(value, bitIdx)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {/* Field legend */}
      {register.fields.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {register.fields.map((field, i) => (
            <span
              key={field.id}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded"
              style={{
                backgroundColor: FIELD_COLORS[i % FIELD_COLORS.length],
                borderLeft: `3px solid ${FIELD_BORDER_COLORS[i % FIELD_BORDER_COLORS.length]}`,
              }}
            >
              {field.name}
              <span className="text-gray-500 dark:text-gray-400">
                [{field.msb === field.lsb ? field.msb : `${field.msb}:${field.lsb}`}]
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
