import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useAppState, useAppDispatch } from '../../context/app-context';
import type { RegisterDef } from '../../types/register';
import { clampToWidth } from '../../utils/bitwise';
import { formatBinary } from '../../utils/format';
import { CopyButton } from '../common/copy-button';

interface Props {
  register: RegisterDef;
}

export function ValueInputBar({ register }: Props) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const value = state.registerValues[register.id] ?? 0n;

  const [hexInput, setHexInput] = useState('');
  const [binInput, setBinInput] = useState('');
  const [decInput, setDecInput] = useState('');
  const focusedField = useRef<'hex' | 'bin' | 'dec' | null>(null);
  const binRef = useRef<HTMLInputElement>(null);
  const binCursorRef = useRef<number>(0);
  const binCursorPending = useRef(false);

  // Sync display strings from current value, skipping the focused field
  useEffect(() => {
    if (focusedField.current !== 'hex')
      setHexInput(value.toString(16).toUpperCase().padStart(Math.ceil(register.width / 4), '0'));
    if (focusedField.current !== 'bin')
      setBinInput(value.toString(2).padStart(register.width, '0'));
    if (focusedField.current !== 'dec')
      setDecInput(value.toString(10));
  }, [value, register.width]);

  // Restore BIN cursor position only after a programmatic value change.
  // No deps: must run after every render because the trigger is a ref, not state.
  useLayoutEffect(() => {
    if (!binCursorPending.current) return;
    binCursorPending.current = false;
    const el = binRef.current;
    if (el && focusedField.current === 'bin') {
      el.setSelectionRange(binCursorRef.current, binCursorRef.current);
    }
  });

  function commitValue(raw: bigint) {
    const clamped = clampToWidth(raw, register.width);
    dispatch({ type: 'SET_REGISTER_VALUE', registerId: register.id, value: clamped });
  }

  function handleHexBlur() {
    try {
      const v = BigInt('0x' + (hexInput || '0'));
      commitValue(v);
    } catch {
      setHexInput(value.toString(16).toUpperCase().padStart(Math.ceil(register.width / 4), '0'));
    }
  }

  function handleBinBlur() {
    try {
      const v = BigInt('0b' + (binInput || '0'));
      commitValue(v);
    } catch {
      setBinInput(value.toString(2).padStart(register.width, '0'));
    }
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

  /** Overwrite-mode keydown handler for the BIN input. */
  function handleBinKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { handleBinBlur(); return; }
    if (e.key !== '0' && e.key !== '1') return;

    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;

    // If there's a selection, let onChange handle it (replacement / select-all)
    if (start !== end) return;

    const formatted = el.value;

    // Find the digit at or after cursor (skip spaces)
    let pos = start;
    while (pos < formatted.length && formatted[pos] === ' ') pos++;

    // If cursor is at the end, let onChange handle it (append mode)
    if (pos >= formatted.length) return;

    // Map formatted position to digit index
    let digitIndex = 0;
    for (let i = 0; i < pos; i++) {
      if (formatted[i] !== ' ') digitIndex++;
    }

    // Overwrite digit in the full-width binary string
    const full = binInput.padStart(register.width, '0');
    const updated = full.slice(0, digitIndex) + e.key + full.slice(digitIndex + 1);

    setBinInput(updated);
    commitValue(BigInt('0b' + updated));

    // Advance cursor past the overwritten digit
    const newFormatted = formatBinary(updated);
    binCursorRef.current = digitToFormattedPos(digitIndex + 1, newFormatted);
    binCursorPending.current = true;

    e.preventDefault();
  }

  const inputBase =
    'flex-1 min-w-0 px-4 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 font-mono shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  const inputPrimary = `${inputBase} rounded-r-lg text-xl py-2.5`;

  const inputSecondary = `${inputBase} text-sm py-1.5`;

  const inputSecondaryStandalone = `${inputSecondary} rounded-lg`;

  const inputSecondaryWithAddon = `${inputSecondary} rounded-r-lg`;

  const addonPrimary =
    'inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-xl font-mono font-semibold select-none';

  const addonSecondary =
    'inline-flex items-center px-2 rounded-l-lg border border-r-0 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-sm font-mono select-none';

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
              type="text"
              value={hexInput}
              onFocus={() => (focusedField.current = 'hex')}
              onChange={(e) => {
                const filtered = e.target.value.replace(/[^0-9A-Fa-f]/g, '');
                setHexInput(filtered);
                try { commitValue(BigInt('0x' + (filtered || '0'))); } catch { /* partial input */ }
              }}
              onBlur={() => { focusedField.current = null; handleHexBlur(); }}
              onKeyDown={(e) => handleKeyDown(e, handleHexBlur)}
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
              type="text"
              value={decInput}
              onFocus={() => (focusedField.current = 'dec')}
              onChange={(e) => {
                const filtered = e.target.value.replace(/[^0-9]/g, '');
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
                ref={binRef}
                type="text"
                value={formatBinary(binInput.padStart(register.width, '0'))}
                onFocus={() => (focusedField.current = 'bin')}
                onChange={(e) => {
                  const rawCursor = e.target.selectionStart ?? 0;
                  const rawValue = e.target.value;

                  // Count binary digits AFTER cursor in the raw input.
                  // Using right-anchored counting because padStart shifts digits
                  // left and slice(-width) drops the MSB — the distance from the
                  // right edge is invariant to both operations.
                  let digitsAfterCursor = 0;
                  for (let i = rawCursor; i < rawValue.length; i++) {
                    if (rawValue[i] !== ' ') digitsAfterCursor++;
                  }

                  const stripped = rawValue.replace(/\s/g, '');
                  const filtered = stripped.replace(/[^01]/g, '');
                  const capped = filtered.length > register.width
                    ? filtered.slice(-register.width)
                    : filtered;

                  // Map from right: target digit position from left = width - digitsAfter
                  const targetDigit = Math.max(0, Math.min(
                    register.width - digitsAfterCursor,
                    register.width,
                  ));
                  const newFormatted = formatBinary(capped.padStart(register.width, '0'));
                  binCursorRef.current = digitToFormattedPos(targetDigit, newFormatted);
                  binCursorPending.current = true;

                  setBinInput(capped);
                  try { commitValue(BigInt('0b' + (capped || '0'))); } catch { /* partial input */ }
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
