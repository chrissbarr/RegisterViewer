import { useMemo, useState } from 'react';
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

/** Pre-computed colors for a field, keyed by field index. */
interface FieldColors {
  nibbleBgColor: string;
  bgColor: string;
  highlightBgColor: string;
  borderColor: string;
}

/** O(1) bit-to-field lookup via pre-built map. */
interface FieldMatch extends FieldColors {
  field: Field;
  index: number;
}

interface FieldLookupResult {
  /** Bit index → field match (first-writer wins for overlapping fields). */
  bitMap: Map<number, FieldMatch>;
  /** Field index → pre-computed colors (for nibble/label rows). */
  colorsByIndex: FieldColors[];
}

function buildFieldLookup(fields: Field[]): FieldLookupResult {
  const bitMap = new Map<number, FieldMatch>();
  const colorsByIndex: FieldColors[] = [];
  for (let i = 0; i < fields.length; i++) {
    const colors: FieldColors = {
      nibbleBgColor: fieldColor(i, 0.15),
      bgColor: fieldColor(i, 0.25),
      highlightBgColor: fieldColor(i, 0.45),
      borderColor: fieldBorderColor(i),
    };
    colorsByIndex.push(colors);
    const f = fields[i];
    const entry: FieldMatch = { ...colors, field: f, index: i };
    for (let bit = f.lsb; bit <= f.msb; bit++) {
      // First-writer wins, matching the old linear-scan first-match semantic
      if (!bitMap.has(bit)) bitMap.set(bit, entry);
    }
  }
  return { bitMap, colorsByIndex };
}

function setsOverlap(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  for (const v of a) {
    if (b.has(v)) return true;
  }
  return false;
}

interface Props {
  register: RegisterDef;
  hoveredFieldIndices: ReadonlySet<number> | null;
  onFieldHover: (indices: ReadonlySet<number> | null) => void;
  fieldHoverSets: ReadonlySet<number>[];
}

export function BitGrid({ register, hoveredFieldIndices, onFieldHover, fieldHoverSets }: Props) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const value = state.registerValues[register.id] ?? 0n;
  const [containerRef, containerWidth] = useContainerWidth<HTMLDivElement>();
  const [hoveredNibbleIndex, setHoveredNibbleIndex] = useState<number | null>(null);

  // Layout: depends only on container width and register width
  const rows = useMemo(() => {
    const bitsPerRow = computeBitsPerRow(containerWidth, register.width);
    return buildRowBits(register.width, bitsPerRow);
  }, [containerWidth, register.width]);

  // O(1) bit-to-field lookup map + per-field-index color array
  const { bitMap: fieldLookup, colorsByIndex: fieldColors } = useMemo(
    () => buildFieldLookup(register.fields),
    [register.fields],
  );

  // Per-row layout data: depends on rows and fields, NOT on value or hover
  const rowLayoutData = useMemo(
    () => rows.map((row) => ({
      rowFields: fieldsForRow(row, register.fields),
      rowUnassigned: unassignedRangesForRow(row, register.fields),
      gtc: gridTemplateColumns(row.bits.length),
    })),
    [rows, register.fields],
  );

  // Per-row nibbles: depends on value (hex digits change) but NOT on hover
  const rowNibblesData = useMemo(
    () => rows.map((row) => nibblesForRow(row, register.width, value, register.fields)),
    [rows, register.width, value, register.fields],
  );

  return (
    <div ref={containerRef}>
      <div className="flex flex-col gap-1">
        {rows.map((row, rowIdx) => {
          const { rowFields, rowUnassigned, gtc } = rowLayoutData[rowIdx];
          const rowNibbles = rowNibblesData[rowIdx];
          const hasLabels = rowFields.length > 0 || rowUnassigned.length > 0;

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
                const isHighlighted = hoveredNibbleIndex !== null
                  ? hoveredNibbleIndex === nibble.nibbleIndex
                  : nibble.fieldIndicesSet.size > 0 &&
                    hoveredFieldIndices !== null &&
                    setsOverlap(nibble.fieldIndicesSet, hoveredFieldIndices);
                const bgColor = nibble.fieldIndex !== null
                  ? (isHighlighted ? fieldColors[nibble.fieldIndex].highlightBgColor : fieldColors[nibble.fieldIndex].nibbleBgColor)
                  : (isHighlighted ? 'rgba(128,128,128,0.25)' : 'rgba(128,128,128,0.1)');
                // Low nibble (even index) within a byte — add left border as nibble separator
                const isNibbleSep = nibble.nibbleIndex % 2 === 0 && nibbleIdx > 0;

                return (
                  <div
                    key={`hex-${nibble.nibbleIndex}`}
                    onMouseEnter={() => {
                      setHoveredNibbleIndex(nibble.nibbleIndex);
                      if (nibble.fieldIndicesSet.size > 0) {
                        onFieldHover(nibble.fieldIndicesSet);
                      }
                    }}
                    onMouseLeave={() => {
                      setHoveredNibbleIndex(null);
                      onFieldHover(null);
                    }}
                    className={`flex items-center justify-center h-7 text-xs font-mono font-bold
                      select-none rounded-t transition-colors duration-150 motion-reduce:transition-none
                      hover:brightness-110
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
                const match = fieldLookup.get(bitIdx);
                const isUnassigned = !match;
                const isHighlighted = match !== undefined && hoveredFieldIndices !== null && hoveredFieldIndices.has(match.index);
                const col = bitToGridColumn(bitIdx, row.startBit, row.bits.length);

                return (
                  <div
                    key={bitIdx}
                    onClick={() => dispatch({ type: 'TOGGLE_BIT', registerId: register.id, bit: bitIdx })}
                    onMouseEnter={() => match && onFieldHover(fieldHoverSets[match.index])}
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
                        backgroundColor: isHighlighted ? match.highlightBgColor : match.bgColor,
                        borderColor: match.borderColor,
                      }),
                    }}
                  >
                    <span className={`text-[10px] leading-none font-mono ${
                      isUnassigned
                        ? 'text-gray-400 dark:text-gray-500'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {bitIdx}
                    </span>
                    <span className={`font-mono font-bold text-sm leading-none mt-0.5 ${
                      isUnassigned ? 'opacity-50' : ''
                    }`}>
                      {getBit(value, bitIdx)}
                    </span>
                  </div>
                );
              })}

              {/* Field labels */}
              {rowFields.map((fi) => {
                const colors = fieldColors[fi.fieldIndex];
                const isHighlighted = hoveredFieldIndices !== null && hoveredFieldIndices.has(fi.fieldIndex);
                const label = fi.isPartial ? `${fi.field.name} (cont.)` : fi.field.name;

                return (
                  <div
                    key={fi.field.id}
                    title={fi.field.name}
                    onMouseEnter={() => onFieldHover(fieldHoverSets[fi.fieldIndex])}
                    onMouseLeave={() => onFieldHover(null)}
                    className="text-[10px] truncate px-1 py-0.5 text-center transition-colors duration-150 motion-reduce:transition-none"
                    style={{
                      gridRow: 3,
                      gridColumn: `${fi.startCol} / ${fi.endCol}`,
                      backgroundColor: isHighlighted ? colors.highlightBgColor : colors.bgColor,
                      borderLeft: `2px solid ${colors.borderColor}`,
                      borderRight: `2px solid ${colors.borderColor}`,
                      borderBottom: `2px solid ${colors.borderColor}`,
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
