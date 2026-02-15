import { useAppState, useAppDispatch } from '../../context/app-context';
import type { RegisterDef, Field } from '../../types/register';
import { getBit } from '../../utils/bitwise';
import { useContainerWidth } from '../../hooks/use-container-width';
import {
  computeBitsPerRow,
  buildRowBits,
  bitToGridColumn,
  gridTemplateColumns,
  fieldsForRow,
  unassignedRangesForRow,
} from '../../utils/bit-grid-layout';

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
  hoveredFieldIndex: number | null;
  onFieldHover: (index: number | null) => void;
}

export function BitGrid({ register, hoveredFieldIndex, onFieldHover }: Props) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const value = state.registerValues[register.id] ?? 0n;
  const [containerRef, containerWidth] = useContainerWidth<HTMLDivElement>();

  const bitsPerRow = computeBitsPerRow(containerWidth, register.width);
  const rows = buildRowBits(register.width, bitsPerRow);

  return (
    <div className="mb-4" ref={containerRef}>
      <div className="flex flex-col gap-1">
        {rows.map((row, rowIdx) => {
          const rowFields = fieldsForRow(row, register.fields);
          const rowUnassigned = unassignedRangesForRow(row, register.fields);
          const hasLabels = rowFields.length > 0 || rowUnassigned.length > 0;
          const gtc = gridTemplateColumns(row.bits.length);

          return (
            <div
              key={rowIdx}
              style={{
                display: 'grid',
                gridTemplateColumns: gtc,
                gridTemplateRows: hasLabels ? 'auto auto' : 'auto',
              }}
            >
              {/* Bit cells */}
              {row.bits.map((bitIdx) => {
                const match = getFieldForBit(bitIdx, register.fields);
                const isUnassigned = !match;
                const bgColor = match ? FIELD_COLORS[match.index % FIELD_COLORS.length] : undefined;
                const highlightBgColor = match ? FIELD_COLORS[match.index % FIELD_COLORS.length].replace(/[\d.]+\)$/, '0.45)') : undefined;
                const borderColor = match ? FIELD_BORDER_COLORS[match.index % FIELD_BORDER_COLORS.length] : undefined;
                const isHighlighted = match !== null && hoveredFieldIndex === match.index;
                const col = bitToGridColumn(bitIdx, row.startBit, row.bits.length);

                return (
                  <div
                    key={bitIdx}
                    onClick={() => dispatch({ type: 'TOGGLE_BIT', registerId: register.id, bit: bitIdx })}
                    onMouseEnter={() => match && onFieldHover(match.index)}
                    onMouseLeave={() => onFieldHover(null)}
                    title={match ? `Bit ${bitIdx} (${match.field.name})` : `Bit ${bitIdx} (reserved)`}
                    className={`flex flex-col items-center justify-center h-12 border text-xs cursor-pointer hover:brightness-125 transition-all duration-150 motion-reduce:transition-none select-none ${
                      isUnassigned
                        ? 'bit-unassigned border-gray-300/60 dark:border-gray-600/60'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                    style={{
                      gridRow: 1,
                      gridColumn: col,
                      ...(match && {
                        backgroundColor: isHighlighted ? highlightBgColor : bgColor,
                        borderColor: borderColor,
                      }),
                    }}
                  >
                    <span className={`text-[10px] leading-none ${
                      isUnassigned
                        ? 'text-gray-400 dark:text-gray-500'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {bitIdx}
                    </span>
                    <span className={`font-bold text-sm leading-none mt-0.5 ${
                      isUnassigned ? 'opacity-50' : ''
                    }`}>
                      {getBit(value, bitIdx)}
                    </span>
                  </div>
                );
              })}

              {/* Field labels */}
              {rowFields.map((fi) => {
                const bgColor = FIELD_COLORS[fi.fieldIndex % FIELD_COLORS.length];
                const highlightBgColor = FIELD_COLORS[fi.fieldIndex % FIELD_COLORS.length].replace(/[\d.]+\)$/, '0.45)');
                const borderColor = FIELD_BORDER_COLORS[fi.fieldIndex % FIELD_BORDER_COLORS.length];
                const isHighlighted = hoveredFieldIndex === fi.fieldIndex;
                const label = fi.isPartial ? `${fi.field.name} (cont.)` : fi.field.name;

                return (
                  <div
                    key={fi.field.id}
                    title={fi.field.name}
                    onMouseEnter={() => onFieldHover(fi.fieldIndex)}
                    onMouseLeave={() => onFieldHover(null)}
                    className="text-[10px] truncate px-1 py-0.5 text-center transition-colors duration-150 motion-reduce:transition-none"
                    style={{
                      gridRow: 2,
                      gridColumn: `${fi.startCol} / ${fi.endCol}`,
                      backgroundColor: isHighlighted ? highlightBgColor : bgColor,
                      borderLeft: `2px solid ${borderColor}`,
                      borderRight: `2px solid ${borderColor}`,
                      borderBottom: `2px solid ${borderColor}`,
                    }}
                  >
                    {label}
                  </div>
                );
              })}

              {/* Unassigned range labels */}
              {rowUnassigned.map((range) => (
                <div
                  key={`rsvd-${range.startBit}-${range.endBit}`}
                  className="bit-unassigned-label text-[10px] truncate px-1 py-0.5 text-center italic border-b border-x border-gray-300/40 dark:border-gray-600/40"
                  style={{
                    gridRow: 2,
                    gridColumn: `${range.startCol} / ${range.endCol}`,
                  }}
                >
                  Rsvd
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
