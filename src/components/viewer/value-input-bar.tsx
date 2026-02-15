import { useState, useEffect, useRef } from 'react';
import { useAppState, useAppDispatch } from '../../context/app-context';
import type { RegisterDef } from '../../types/register';
import { clampToWidth } from '../../utils/bitwise';

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
      </label>

      {/* SECONDARY: DEC + BIN side by side — smaller text */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex items-center gap-2 min-w-0">
          <span className={labelClass}>DEC</span>
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
        </label>
        <label className="flex items-center gap-2 min-w-0">
          <span className={labelClass}>BIN</span>
          <div className="flex flex-1 min-w-0">
            <span className={addonSecondary}>0b</span>
            <input
              type="text"
              value={binInput}
              onFocus={() => (focusedField.current = 'bin')}
              onChange={(e) => {
                const filtered = e.target.value.replace(/[^01]/g, '');
                setBinInput(filtered);
                try { commitValue(BigInt('0b' + (filtered || '0'))); } catch { /* partial input */ }
              }}
              onBlur={() => { focusedField.current = null; handleBinBlur(); }}
              onKeyDown={(e) => handleKeyDown(e, handleBinBlur)}
              className={inputSecondaryWithAddon}
              spellCheck={false}
            />
          </div>
        </label>
      </div>
    </div>
  );
}
