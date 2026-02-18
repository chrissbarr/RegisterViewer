import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useAppState, useAppDispatch } from '../../context/app-context';
import type { RegisterDef } from '../../types/register';
import { clampToWidth } from '../../utils/bitwise';
import { formatBinary } from '../../utils/format';
import { CopyButton } from '../common/copy-button';

interface Props {
  register: RegisterDef;
}

const HEX_CHAR = /[0-9A-Fa-f]/;
const DEC_CHAR = /[0-9]/;

interface CursorState {
  ref: React.RefObject<HTMLInputElement | null>;
  posRef: React.RefObject<number>;
  pendingRef: React.RefObject<boolean>;
}

function useCursorRestore(field: string, focusedField: React.RefObject<string | null>): CursorState {
  const ref = useRef<HTMLInputElement>(null);
  const posRef = useRef<number>(0);
  const pendingRef = useRef(false);

  useLayoutEffect(() => {
    if (!pendingRef.current) return;
    pendingRef.current = false;
    const el = ref.current;
    if (el && focusedField.current === field) {
      el.setSelectionRange(posRef.current, posRef.current);
    }
  });

  return { ref, posRef, pendingRef };
}

export function ValueInputBar({ register }: Props) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const value = state.registerValues[register.id] ?? 0n;

  const [hexInput, setHexInput] = useState('');
  const [binInput, setBinInput] = useState('');
  const [decInput, setDecInput] = useState('');
  const focusedField = useRef<'hex' | 'bin' | 'dec' | null>(null);
  const hex = useCursorRestore('hex', focusedField);
  const dec = useCursorRestore('dec', focusedField);
  const bin = useCursorRestore('bin', focusedField);

  // Sync display strings from current value, skipping the focused field
  useEffect(() => {
    if (focusedField.current !== 'hex')
      setHexInput(value.toString(16).toUpperCase().padStart(Math.ceil(register.width / 4), '0'));
    if (focusedField.current !== 'bin')
      setBinInput(value.toString(2).padStart(register.width, '0'));
    if (focusedField.current !== 'dec')
      setDecInput(value.toString(10));
  }, [value, register.width]);

  function commitValue(raw: bigint) {
    const clamped = clampToWidth(raw, register.width);
    dispatch({ type: 'SET_REGISTER_VALUE', registerId: register.id, value: clamped });
  }

  const hexWidth = Math.ceil(register.width / 4);

  function hexCommit(digits: string) {
    const padded = digits.toUpperCase().padEnd(hexWidth, '0').slice(0, hexWidth);
    setHexInput(padded);
    commitValue(BigInt('0x' + padded));
  }

  function handleHexBlur() {
    // Normalize display to canonical zero-padded format from canonical value
    setHexInput(value.toString(16).toUpperCase().padStart(hexWidth, '0'));
  }

  /** Replace a range of digits with a replacement string, commit, and set cursor position. */
  function hexOverwrite(full: string, from: number, to: number, replacement: string, cursorPos: number) {
    const updated = full.slice(0, from) + replacement + full.slice(to);
    hexCommit(updated);
    hex.posRef.current = cursorPos;
    hex.pendingRef.current = true;
  }

  /** Overwrite-mode keydown handler for the HEX input. */
  function handleHexKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { handleHexBlur(); return; }

    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const full = hexInput.padEnd(hexWidth, '0').slice(0, hexWidth);

    // Backspace: replace digit before cursor with '0', move cursor left
    if (e.key === 'Backspace') {
      if (start !== end) {
        hexOverwrite(full, start, end, '0'.repeat(end - start), start);
      } else if (start > 0) {
        hexOverwrite(full, start - 1, start, '0', start - 1);
      }
      e.preventDefault();
      return;
    }

    // Delete: replace digit at cursor with '0', cursor stays
    if (e.key === 'Delete') {
      if (start !== end) {
        hexOverwrite(full, start, end, '0'.repeat(end - start), start);
      } else if (start < hexWidth) {
        hexOverwrite(full, start, start + 1, '0', start);
      }
      e.preventDefault();
      return;
    }

    // Hex digit: overwrite at cursor position, advance cursor
    if (HEX_CHAR.test(e.key) && e.key.length === 1) {
      // If there's a selection, let onChange handle it (select-all + type)
      if (start !== end) return;

      // If cursor is at the end, nothing to overwrite
      if (start >= hexWidth) {
        e.preventDefault();
        return;
      }

      hexOverwrite(full, start, start + 1, e.key.toUpperCase(), start + 1);
      e.preventDefault();
    }
  }

  function handleBinBlur() {
    // Normalize display to canonical zero-padded format from canonical value
    setBinInput(value.toString(2).padStart(register.width, '0'));
  }

  function handleDecBlur() {
    try {
      const v = BigInt(decInput || '0');
      commitValue(v);
    } catch {
      setDecInput(value.toString(10));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, onBlur: () => void) {
    if (e.key === 'Enter') onBlur();
  }

  /** Map a 0-based digit index to a cursor position in the formatted string. */
  function digitToFormattedPos(digitIndex: number, formatted: string): number {
    let pos = 0;
    let count = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (count >= digitIndex) break;
      if (formatted[i] !== ' ') count++;
      pos = i + 1;
    }
    return pos;
  }

  /** Map a cursor position in the formatted string to a 0-based digit index. */
  function formattedPosToDigit(pos: number, formatted: string): number {
    let count = 0;
    for (let i = 0; i < pos && i < formatted.length; i++) {
      if (formatted[i] !== ' ') count++;
    }
    return count;
  }

  /** Replace a range of digits in the binary string, commit, and set cursor position. */
  function binOverwrite(full: string, from: number, to: number, replacement: string, cursorDigit: number) {
    const updated = full.slice(0, from) + replacement + full.slice(to);
    setBinInput(updated);
    commitValue(BigInt('0b' + updated));
    const newFormatted = formatBinary(updated);
    bin.posRef.current = digitToFormattedPos(cursorDigit, newFormatted);
    bin.pendingRef.current = true;
  }

  /** Overwrite-mode keydown handler for the BIN input. */
  function handleBinKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { handleBinBlur(); return; }

    const el = e.currentTarget;
    const formatted = el.value;
    const rawStart = el.selectionStart ?? 0;
    const rawEnd = el.selectionEnd ?? 0;
    const start = formattedPosToDigit(rawStart, formatted);
    const end = formattedPosToDigit(rawEnd, formatted);
    const full = binInput.padStart(register.width, '0');

    // Backspace: replace digit before cursor with '0', move cursor left
    if (e.key === 'Backspace') {
      if (start !== end) {
        binOverwrite(full, start, end, '0'.repeat(end - start), start);
      } else if (start > 0) {
        binOverwrite(full, start - 1, start, '0', start - 1);
      }
      e.preventDefault();
      return;
    }

    // Delete: replace digit at cursor with '0', cursor stays
    if (e.key === 'Delete') {
      if (start !== end) {
        binOverwrite(full, start, end, '0'.repeat(end - start), start);
      } else if (start < register.width) {
        binOverwrite(full, start, start + 1, '0', start);
      }
      e.preventDefault();
      return;
    }

    // Binary digit: overwrite at cursor position, advance cursor
    if ((e.key === '0' || e.key === '1') && e.key.length === 1) {
      // If there's a selection, let onChange handle it (select-all + type)
      if (start !== end) return;

      // If cursor is at the end, nothing to overwrite
      if (start >= register.width) {
        e.preventDefault();
        return;
      }

      binOverwrite(full, start, start + 1, e.key, start + 1);
      e.preventDefault();
    }
  }

  const inputBase =
    'flex-1 min-w-0 px-4 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-mono shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  const inputPrimary = `${inputBase} rounded-r-lg text-xl py-2.5`;

  const inputSecondary = `${inputBase} text-sm py-1.5`;

  const inputSecondaryStandalone = `${inputSecondary} rounded-lg`;

  const inputSecondaryWithAddon = `${inputSecondary} rounded-r-lg`;

  const addonPrimary =
    'inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-xl font-mono font-semibold select-none shadow-sm';

  const addonSecondary =
    'inline-flex items-center px-2 rounded-l-lg border border-r-0 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-sm font-mono select-none shadow-sm';

  const labelClass =
    'text-sm font-semibold text-gray-500 dark:text-gray-400 w-10 shrink-0';

  return (
    <div className="flex flex-col gap-3">
      {/* PRIMARY: HEX input — larger text, bolder presence */}
      <label className="flex items-center gap-2">
        <span className={labelClass}>HEX</span>
        <div className="flex flex-1 min-w-0 items-center gap-1">
          <div className="flex flex-1 min-w-0">
            <span className={addonPrimary}>0x</span>
            <input
              ref={hex.ref}
              type="text"
              value={hexInput}
              onFocus={() => (focusedField.current = 'hex')}
              onChange={(e) => {
                const raw = e.target.value;
                const cursorPos = e.target.selectionStart ?? 0;
                // Strip 0x/0X prefix at start only (handles paste of "0xFF" style values)
                const stripped = raw.replace(/^0[xX]/, '');
                const prefixLen = raw.length - stripped.length;
                const adjustedCursor = Math.max(0, cursorPos - prefixLen);
                const filtered = stripped.replace(/[^0-9A-Fa-f]/g, '');
                // Left-align: pad right with zeros, truncate to exact width
                const padded = filtered.toUpperCase().padEnd(hexWidth, '0').slice(0, hexWidth);
                // Count valid hex chars before adjusted cursor in the stripped string
                let validBeforeCursor = 0;
                for (let i = 0; i < adjustedCursor && i < stripped.length; i++) {
                  if (HEX_CHAR.test(stripped[i])) validBeforeCursor++;
                }
                hex.posRef.current = Math.min(validBeforeCursor, hexWidth);
                hex.pendingRef.current = true;
                setHexInput(padded);
                commitValue(BigInt('0x' + padded));
              }}
              onBlur={() => { focusedField.current = null; handleHexBlur(); }}
              onKeyDown={handleHexKeyDown}
              className={inputPrimary}
              spellCheck={false}
            />
          </div>
          <CopyButton value={'0x' + hexInput} label="Copy hex value" />
        </div>
      </label>

      {/* SECONDARY: DEC + BIN side by side — smaller text */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex items-center gap-2 min-w-0">
          <span className={labelClass}>DEC</span>
          <div className="flex flex-1 min-w-0 items-center gap-1">
            <input
              ref={dec.ref}
              type="text"
              value={decInput}
              onFocus={() => (focusedField.current = 'dec')}
              onChange={(e) => {
                const raw = e.target.value;
                const cursorPos = e.target.selectionStart ?? 0;
                const filtered = raw.replace(/[^0-9]/g, '');
                let validBeforeCursor = 0;
                for (let i = 0; i < cursorPos && i < raw.length; i++) {
                  if (DEC_CHAR.test(raw[i])) validBeforeCursor++;
                }
                dec.posRef.current = validBeforeCursor;
                dec.pendingRef.current = true;
                setDecInput(filtered);
                try { commitValue(BigInt(filtered || '0')); } catch { /* partial input */ }
              }}
              onBlur={() => { focusedField.current = null; handleDecBlur(); }}
              onKeyDown={(e) => handleKeyDown(e, handleDecBlur)}
              className={inputSecondaryStandalone}
              spellCheck={false}
            />
            <CopyButton value={decInput} label="Copy decimal value" />
          </div>
        </label>
        <label className="flex items-center gap-2 min-w-0">
          <span className={labelClass}>BIN</span>
          <div className="flex flex-1 min-w-0 items-center gap-1">
            <div className="flex flex-1 min-w-0">
              <span className={addonSecondary}>0b</span>
              <input
                ref={bin.ref}
                type="text"
                value={formatBinary(binInput.padStart(register.width, '0'))}
                onFocus={() => (focusedField.current = 'bin')}
                onChange={(e) => {
                  const raw = e.target.value;
                  const cursorPos = e.target.selectionStart ?? 0;
                  // Strip 0b/0B prefix at start only (handles paste of "0b1010" style values)
                  const stripped = raw.replace(/^0[bB]/, '');
                  const prefixLen = raw.length - stripped.length;
                  const adjustedCursor = Math.max(0, cursorPos - prefixLen);
                  // Remove spaces then filter to binary digits only
                  const noSpaces = stripped.replace(/\s/g, '');
                  const filtered = noSpaces.replace(/[^01]/g, '');
                  // Left-align: pad right with zeros, truncate to exact width
                  const padded = filtered.padEnd(register.width, '0').slice(0, register.width);
                  // Count valid binary chars before adjusted cursor in the stripped string
                  let validBeforeCursor = 0;
                  for (let i = 0; i < adjustedCursor && i < stripped.length; i++) {
                    if (stripped[i] === '0' || stripped[i] === '1') validBeforeCursor++;
                  }
                  const targetDigit = Math.min(validBeforeCursor, register.width);
                  const newFormatted = formatBinary(padded);
                  bin.posRef.current = digitToFormattedPos(targetDigit, newFormatted);
                  bin.pendingRef.current = true;

                  setBinInput(padded);
                  commitValue(BigInt('0b' + padded));
                }}
                onBlur={() => { focusedField.current = null; handleBinBlur(); }}
                onKeyDown={handleBinKeyDown}
                className={inputSecondaryWithAddon}
                spellCheck={false}
              />
            </div>
            <CopyButton value={'0b' + binInput} label="Copy binary value" />
          </div>
        </label>
      </div>
    </div>
  );
}
