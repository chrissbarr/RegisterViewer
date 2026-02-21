import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { MAP_TABLE_WIDTH_VALUES, type MapTableWidth, type RegisterDef } from '../../types/register';
import { useAppState, useAppDispatch } from '../../context/app-context';
import {
  buildMapRegisters,
  computeMapRows,
  getOverlapWarningIds,
  type FieldSegment,
  type MapCell,
  type MapRow,
} from '../../utils/map-layout';
import { getRegisterOverlapWarnings } from '../../utils/validation';
import { fieldColor, fieldBorderColor } from '../../utils/field-colors';
import { formatOffset, offsetHexDigits } from '../../utils/format';

const OVERLAP_COLOR = 'rgb(251,146,60)';
const OVERLAP_HATCH_BG = `repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(251,146,60,0.08) 3px, rgba(251,146,60,0.08) 6px)`;

interface RegisterMapViewProps {
  registers: RegisterDef[];
  onNavigateToRegister: (registerId: string) => void;
  scrollTopRef?: RefObject<number>;
  onScrollChange?: (scrollTop: number) => void;
}

export function RegisterMapView({
  registers,
  onNavigateToRegister,
  scrollTopRef,
  onScrollChange,
}: RegisterMapViewProps) {
  const { mapTableWidth: tableWidthBits, mapShowGaps: showGaps, mapSortDescending: sortDescending, addressUnitBits } = useAppState();
  const dispatch = useAppDispatch();
  const setTableWidthBits = useCallback(
    (width: MapTableWidth) => dispatch({ type: 'SET_MAP_TABLE_WIDTH', width }),
    [dispatch],
  );
  const setShowGaps = useCallback(
    (show: boolean) => dispatch({ type: 'SET_MAP_SHOW_GAPS', showGaps: show }),
    [dispatch],
  );
  const toggleSortOrder = useCallback(
    () => dispatch({ type: 'SET_MAP_SORT_DESCENDING', descending: !sortDescending }),
    [dispatch, sortDescending],
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore scroll position on mount
  useEffect(() => {
    if (scrollTopRef != null && scrollTopRef.current > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollTopRef.current;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const overlapWarnings = useMemo(
    () => getRegisterOverlapWarnings(registers, addressUnitBits),
    [registers, addressUnitBits],
  );
  const overlapWarningIds = useMemo(
    () => getOverlapWarningIds(overlapWarnings),
    [overlapWarnings],
  );
  const mapRegisters = useMemo(
    () => buildMapRegisters(registers, overlapWarningIds, addressUnitBits),
    [registers, overlapWarningIds, addressUnitBits],
  );

  const hexDigits = useMemo(
    () => offsetHexDigits(mapRegisters.length > 0 ? mapRegisters[mapRegisters.length - 1].endUnit : 0),
    [mapRegisters],
  );

  const rowWidthUnits = tableWidthBits / addressUnitBits;
  const mapRows = useMemo(() => {
    const rows = computeMapRows(mapRegisters, rowWidthUnits, showGaps, addressUnitBits);
    return sortDescending ? [...rows].reverse() : rows;
  }, [mapRegisters, rowWidthUnits, showGaps, addressUnitBits, sortDescending]);

  if (mapRegisters.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-500">
        <div className="text-center">
          <p className="text-lg mb-2">No registers with offsets</p>
          <p className="text-sm">
            Set an offset on a register in the editor to place it in the map.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      data-testid="map-view"
      className="flex-1 overflow-y-auto p-4"
      onScroll={onScrollChange ? (e) => onScrollChange((e.target as HTMLElement).scrollTop) : undefined}
    >
      {/* Controls */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
          {MAP_TABLE_WIDTH_VALUES.filter((bits) => bits >= addressUnitBits).map((bits) => (
            <button
              key={bits}
              onClick={() => setTableWidthBits(bits)}
              className={`px-3 py-1 font-mono transition-colors ${
                tableWidthBits === bits
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {bits}b
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showGaps}
            onChange={(e) => setShowGaps(e.target.checked)}
            className="rounded"
          />
          Show gaps
        </label>
        <button
          onClick={toggleSortOrder}
          aria-label="Toggle sort order"
          title={sortDescending ? 'Sorted descending — click for ascending' : 'Sorted ascending — click for descending'}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            {sortDescending ? (
              <path d="M8 1a.5.5 0 0 1 .5.5v11.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L7.5 13.293V1.5A.5.5 0 0 1 8 1z" />
            ) : (
              <path d="M8 15a.5.5 0 0 0 .5-.5V2.707l3.146 3.147a.5.5 0 0 0 .708-.708l-4-4a.5.5 0 0 0-.708 0l-4 4a.5.5 0 0 0 .708.708L7.5 2.707V14.5A.5.5 0 0 0 8 15z" />
            )}
          </svg>
          <span className="text-xs">{sortDescending ? 'Desc' : 'Asc'}</span>
        </button>
      </div>

      {/* Column headers */}
      <div className="flex items-end mb-1">
        <div className="w-16 shrink-0" />
        <div
          className="flex-1"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${rowWidthUnits}, 1fr)`,
          }}
        >
          {Array.from({ length: rowWidthUnits }, (_, i) => (
            <div
              key={i}
              className="text-[11px] font-mono font-medium text-gray-500 dark:text-gray-400 text-center"
            >
              +{i}
            </div>
          ))}
        </div>
      </div>

      {/* Map rows */}
      <div className="divide-y divide-gray-200 dark:divide-gray-700/50 border-t border-gray-200 dark:border-gray-700/50">
        {mapRows.map((row, rowIdx) => {
          // Non-contiguous gap separator (when showGaps is off)
          const prevRow = mapRows[rowIdx - 1];
          const needsSeparator =
            !showGaps &&
            prevRow &&
            !prevRow.isGapRow &&
            (sortDescending
              ? row.bandEnd < prevRow.bandStart - 1
              : row.bandStart > prevRow.bandEnd + 1);

          return (
            <div key={row.bandStart}>
              {needsSeparator && (
                <div className="text-center text-xs text-gray-400 dark:text-gray-600 py-0.5 border-b border-gray-200 dark:border-gray-700/50">
                  ···
                </div>
              )}
              <MapRowView
                row={row}
                rowWidthUnits={rowWidthUnits}
                hexDigits={hexDigits}
                onNavigateToRegister={onNavigateToRegister}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MapRowView({
  row,
  rowWidthUnits,
  hexDigits,
  onNavigateToRegister,
}: {
  row: MapRow;
  rowWidthUnits: number;
  hexDigits: number;
  onNavigateToRegister: (registerId: string) => void;
}) {
  if (row.isGapRow) {
    return (
      <div className="flex items-center min-h-[2rem] hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
        <div className="w-20 shrink-0 font-mono text-xs font-medium text-gray-500 dark:text-gray-400 text-right pr-3">
          {formatOffset(row.bandStart, hexDigits)}
        </div>
        <div className="flex-1 border border-dashed border-gray-300 dark:border-gray-700 rounded h-6 bg-gray-50 dark:bg-gray-900/20" />
      </div>
    );
  }

  return (
    <div className="flex items-stretch min-h-[2.5rem] hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
      <div className="w-20 shrink-0 font-mono text-xs font-medium text-gray-500 dark:text-gray-400 text-right pr-3 flex items-center justify-end">
        {formatOffset(row.bandStart, hexDigits)}
      </div>
      <div
        className="flex-1"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${rowWidthUnits}, 1fr)`,
        }}
      >
        {row.cells.map((cell, i) =>
          cell.kind === 'register' ? (
            <RegisterCell
              key={i}
              cell={cell}
              hexDigits={hexDigits}
              onNavigateToRegister={onNavigateToRegister}
            />
          ) : (
            <GapCell key={i} cell={cell} />
          ),
        )}
      </div>
    </div>
  );
}

function RegisterCell({
  cell,
  hexDigits,
  onNavigateToRegister,
}: {
  cell: Extract<MapCell, { kind: 'register' }>;
  hexDigits: number;
  onNavigateToRegister: (registerId: string) => void;
}) {
  const { mapReg, rowSpanIndex, totalRowSpans, colStart, colEnd, fieldSegments } = cell;
  const hasFields = fieldSegments.length > 0;
  const isOverlap = mapReg.hasOverlap;
  const borderWidth = isOverlap ? 'border-2' : 'border';

  return (
    <div
      style={{ gridColumn: `${colStart} / ${colEnd}` }}
      className="mx-0.5 my-0.5 flex flex-col overflow-hidden rounded-sm cursor-pointer hover:opacity-80 transition-opacity"
      onClick={() => onNavigateToRegister(mapReg.reg.id)}
      title={`${mapReg.reg.name} @ ${formatOffset(mapReg.startUnit, hexDigits)}, ${mapReg.reg.width}b`}
    >
      {/* Name row */}
      <div
        style={{
          ...(isOverlap
            ? { borderColor: OVERLAP_COLOR, backgroundImage: OVERLAP_HATCH_BG }
            : {}),
        }}
        className={`flex items-center justify-between px-2 py-1 text-xs ${borderWidth} ${hasFields ? 'border-b-0 rounded-t-sm' : 'rounded-sm'} ${
          isOverlap
            ? ''
            : 'bg-slate-100 border-slate-300 dark:bg-slate-800/60 dark:border-slate-600'
        }`}
      >
        <span className="truncate font-medium">
          {mapReg.reg.name}
          {totalRowSpans > 1 && (
            <span className="text-gray-400 dark:text-gray-500 font-normal ml-1 text-[10px]">
              ({rowSpanIndex + 1}/{totalRowSpans})
            </span>
          )}
        </span>
        <span className="flex items-center shrink-0">
          {rowSpanIndex === totalRowSpans - 1 && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400 ml-1 font-mono">
              {mapReg.reg.width}b
            </span>
          )}
          {mapReg.hasOverlap && rowSpanIndex === 0 && (
            <span className="ml-1 text-orange-400" title="Overlaps another register">⚠</span>
          )}
        </span>
      </div>
      {/* Field decomposition row */}
      {hasFields && (
        <FieldDecompositionRow
          fieldSegments={fieldSegments}
          cellStartBit={cell.cellStartBit}
          cellEndBit={cell.cellEndBit}
          borderColor={isOverlap ? OVERLAP_COLOR : undefined}
          borderWidth={borderWidth}
          isOverlap={isOverlap}
        />
      )}
    </div>
  );
}

function FieldDecompositionRow({
  fieldSegments,
  cellStartBit,
  cellEndBit,
  borderColor,
  borderWidth,
  isOverlap,
}: {
  fieldSegments: FieldSegment[];
  cellStartBit: number;
  cellEndBit: number;
  borderColor?: string;
  borderWidth: string;
  isOverlap: boolean;
}) {
  // Build items array interleaving reserved gaps between/around field segments.
  // Segments are sorted MSB→LSB (highest bit first). clampedMsb/clampedLsb
  // are register-relative bit positions, same coordinate space as cellStartBit/cellEndBit.
  type Item = { kind: 'field'; seg: FieldSegment } | { kind: 'rsvd'; widthBits: number };
  const items: Item[] = [];
  let cursor = cellEndBit; // start at cell's MSB

  for (const seg of fieldSegments) {
    // Gap above this segment (guard > 0 for overlapping-field edge cases)
    const gapWidth = cursor - seg.clampedMsb;
    if (gapWidth > 0) {
      items.push({ kind: 'rsvd', widthBits: gapWidth });
    }
    items.push({ kind: 'field', seg });
    cursor = seg.clampedLsb - 1;
  }
  // Trailing gap below the last segment
  const trailingWidth = cursor - cellStartBit + 1;
  if (trailingWidth > 0) {
    items.push({ kind: 'rsvd', widthBits: trailingWidth });
  }

  return (
    <div
      style={borderColor ? { borderColor } : undefined}
      className={`flex items-stretch ${borderWidth} border-t-0 rounded-b-sm overflow-hidden ${
        !isOverlap ? 'border-slate-300 dark:border-slate-600' : ''
      }`}
    >
      {items.map((item, i) => {
        if (item.kind === 'rsvd') {
          return (
            <div
              key={`rsvd-${i}`}
              style={{ flexGrow: item.widthBits, flexBasis: 0 }}
              className="flex items-center justify-center px-0.5 py-0.5 text-[9px] italic
                text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/20 min-w-0"
            >
              {item.widthBits >= 4 && <span className="truncate">Rsvd</span>}
            </div>
          );
        }
        const { seg } = item;
        return (
          <div
            key={seg.field.id + '-' + i}
            style={{
              flexGrow: seg.widthBits,
              flexBasis: 0,
              backgroundColor: fieldColor(seg.fieldIndex, 0.25),
              borderLeftColor: fieldBorderColor(seg.fieldIndex),
              borderRightColor: fieldBorderColor(seg.fieldIndex),
            }}
            className="flex items-center justify-center px-0.5 py-0.5 text-[9px] truncate border-l border-r min-w-0"
            title={seg.isPartial ? `${seg.field.name} (partial)` : seg.field.name}
          >
            <span className="truncate">
              {seg.field.name}
              {seg.isPartial && <span className="opacity-50">…</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function GapCell({ cell }: { cell: Extract<MapCell, { kind: 'gap' }> }) {
  return (
    <div
      style={{ gridColumn: `${cell.colStart} / ${cell.colEnd}` }}
      className="mx-0.5 my-0.5 rounded-sm border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20"
    />
  );
}
