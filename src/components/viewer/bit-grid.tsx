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
  nibblesForRow,
} from '../../utils/bit-grid-layout';
import { fieldColor, fieldBorderColor } from '../../utils/field-colors';

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
    <div ref={containerRef}>
      <div className="flex flex-col gap-1">
        {rows.map((row, rowIdx) => {
          const rowFields = fieldsForRow(row, register.fields);
          const rowUnassigned = unassignedRangesForRow(row, register.fields);
          const rowNibbles = nibblesForRow(row, register.width, value, register.fields);
          const hasLabels = rowFields.length > 0 || rowUnassigned.length > 0;
          const gtc = gridTemplateColumns(row.bits.length);

          return (
            <div
              key={rowIdx}
              style={{
                display: 'grid',
                gridTemplateColumns: gtc,
                gridTemplateRows: hasLabels ? 'auto auto auto' : 'auto auto',
              }}
            >
              {/* Hex digit row */}
              {rowNibbles.map((nibble, nibbleIdx) => {
                const bgColor = nibble.fieldIndex !== null
                  ? fieldColor(nibble.fieldIndex, 0.15)
                  : 'rgba(128,128,128,0.1)';
                // Low nibble (even index) within a byte — add left border as nibble separator
                const isNibbleSep = nibble.nibbleIndex % 2 === 0 && nibbleIdx > 0;

                return (
                  <div
                    key={`hex-${nibble.nibbleIndex}`}
                    className={`flex items-center justify-center h-7 text-xs font-mono font-bold
                      select-none rounded-t
                      ${nibble.isPartial ? 'opacity-60' : ''}
                      ${nibble.fieldIndex === null ? 'text-gray-500 dark:text-gray-400' : ''}`}
                    style={{
                      gridRow: 1,
                      gridColumn: `${nibble.startCol} / ${nibble.endCol}`,
                      backgroundColor: bgColor,
                      ...(isNibbleSep && {
                        borderLeft: '1px solid rgba(156,163,175,0.4)',
                      }),
                    }}
                  >
                    {nibble.hexDigit}
                  </div>
                );
              })}

              {/* Bit cells */}
              {row.bits.map((bitIdx) => {
                const match = getFieldForBit(bitIdx, register.fields);
                const isUnassigned = !match;
                const bgColor = match ? fieldColor(match.index, 0.25) : undefined;
                const highlightBgColor = match ? fieldColor(match.index, 0.45) : undefined;
                const borderColor = match ? fieldBorderColor(match.index) : undefined;
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
                      gridRow: 2,
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
                const bgColor = fieldColor(fi.fieldIndex, 0.25);
                const highlightBgColor = fieldColor(fi.fieldIndex, 0.45);
                const borderColor = fieldBorderColor(fi.fieldIndex);
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
                      gridRow: 3,
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
                    gridRow: 3,
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
