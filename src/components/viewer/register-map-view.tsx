import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { MapTableWidth, RegisterDef } from '../../types/register';
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
import { formatOffset } from '../../utils/format';

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
  const { mapTableWidth: tableWidthBits, mapShowGaps: showGaps } = useAppState();
  const dispatch = useAppDispatch();
  const setTableWidthBits = useCallback(
    (width: MapTableWidth) => dispatch({ type: 'SET_MAP_TABLE_WIDTH', width }),
    [dispatch],
  );
  const setShowGaps = useCallback(
    (show: boolean) => dispatch({ type: 'SET_MAP_SHOW_GAPS', showGaps: show }),
    [dispatch],
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore scroll position on mount
  useEffect(() => {
    if (scrollTopRef != null && scrollTopRef.current > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollTopRef.current;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const overlapWarnings = useMemo(
    () => getRegisterOverlapWarnings(registers),
    [registers],
  );
  const overlapWarningIds = useMemo(
    () => getOverlapWarningIds(overlapWarnings),
    [overlapWarnings],
  );
  const mapRegisters = useMemo(
    () => buildMapRegisters(registers, overlapWarningIds),
    [registers, overlapWarningIds],
  );

  const rowWidthBytes = tableWidthBits / 8;
  const mapRows = useMemo(
    () => computeMapRows(mapRegisters, rowWidthBytes, showGaps),
    [mapRegisters, rowWidthBytes, showGaps],
  );

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
      className="flex-1 overflow-y-auto p-4"
      onScroll={onScrollChange ? (e) => onScrollChange((e.target as HTMLElement).scrollTop) : undefined}
    >
      {/* Controls */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
          {([8, 16, 32] as const).map((bits) => (
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
      </div>

      {/* Column headers */}
      <div className="flex items-end mb-1">
        <div className="w-16 shrink-0" />
        <div
          className="flex-1"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${rowWidthBytes}, 1fr)`,
          }}
        >
          {Array.from({ length: rowWidthBytes }, (_, i) => (
            <div
              key={i}
              className="text-[10px] font-mono text-gray-400 dark:text-gray-500 text-center"
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
            row.bandStart > prevRow.bandEnd + 1;

          return (
            <div key={row.bandStart}>
              {needsSeparator && (
                <div className="text-center text-xs text-gray-400 dark:text-gray-600 py-0.5 border-b border-gray-200 dark:border-gray-700/50">
                  ···
                </div>
              )}
              <MapRowView
                row={row}
                rowWidthBytes={rowWidthBytes}
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
  rowWidthBytes,
  onNavigateToRegister,
}: {
  row: MapRow;
  rowWidthBytes: number;
  onNavigateToRegister: (registerId: string) => void;
}) {
  if (row.isGapRow) {
    return (
      <div className="flex items-center min-h-[2rem]">
        <div className="w-16 shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500 text-right pr-3">
          {formatOffset(row.bandStart)}
        </div>
        <div className="flex-1 border border-dashed border-gray-300 dark:border-gray-700 rounded h-6 bg-gray-50 dark:bg-gray-900/20" />
      </div>
    );
  }

  return (
    <div className="flex items-stretch min-h-[2.5rem]">
      <div className="w-16 shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500 text-right pr-3 flex items-center justify-end">
        {formatOffset(row.bandStart)}
      </div>
      <div
        className="flex-1"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${rowWidthBytes}, 1fr)`,
        }}
      >
        {row.cells.map((cell, i) =>
          cell.kind === 'register' ? (
            <RegisterCell
              key={i}
              cell={cell}
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
  onNavigateToRegister,
}: {
  cell: Extract<MapCell, { kind: 'register' }>;
  onNavigateToRegister: (registerId: string) => void;
}) {
  const { mapReg, rowSpanIndex, totalRowSpans, colStart, colEnd, fieldSegments } = cell;
  const hasFields = fieldSegments.length > 0;
  const borderColor = mapReg.hasOverlap
    ? 'rgb(251,146,60)'
    : fieldBorderColor(mapReg.colorIndex);
  const borderWidth = mapReg.hasOverlap ? 'border-2' : 'border';

  return (
    <div
      style={{ gridColumn: `${colStart} / ${colEnd}` }}
      className="mx-0.5 my-0.5 flex flex-col overflow-hidden rounded-sm cursor-pointer hover:opacity-80 transition-opacity"
      onClick={() => onNavigateToRegister(mapReg.reg.id)}
      title={`${mapReg.reg.name} @ ${formatOffset(mapReg.startByte)}, ${mapReg.reg.width}b`}
    >
      {/* Name row */}
      <div
        style={{
          backgroundColor: fieldColor(mapReg.colorIndex, 0.15),
          borderColor,
        }}
        className={`flex items-center justify-between px-2 py-0.5 text-xs ${borderWidth} ${hasFields ? 'border-b-0 rounded-t-sm' : 'rounded-sm'}`}
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
          borderColor={borderColor}
          borderWidth={borderWidth}
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
}: {
  fieldSegments: FieldSegment[];
  cellStartBit: number;
  cellEndBit: number;
  borderColor: string;
  borderWidth: string;
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
      style={{ borderColor }}
      className={`flex items-stretch ${borderWidth} border-t-0 rounded-b-sm overflow-hidden`}
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
