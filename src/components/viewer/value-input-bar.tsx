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
    'flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-lg font-mono shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  const inputStandalone = `${inputBase} rounded-lg`;

  const inputWithAddon = `${inputBase} rounded-r-lg`;

  const addonClass =
    'inline-flex items-center px-3 rounded-l-lg border border-r-0 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-lg font-mono select-none';

  const labelClass =
    'text-sm font-semibold text-gray-500 dark:text-gray-400 w-10 shrink-0';

  return (
    <div className="flex flex-col gap-3 mb-4 max-w-2xl">
      {/* DEC — no prefix addon */}
      <label className="flex items-center gap-2">
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
          className={inputStandalone}
          spellCheck={false}
        />
      </label>

      {/* HEX — 0x prefix addon */}
      <label className="flex items-center gap-2">
        <span className={labelClass}>HEX</span>
        <div className="flex flex-1">
          <span className={addonClass}>0x</span>
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
            className={inputWithAddon}
            spellCheck={false}
          />
        </div>
      </label>

      {/* BIN — 0b prefix addon */}
      <label className="flex items-center gap-2">
        <span className={labelClass}>BIN</span>
        <div className="flex flex-1">
          <span className={addonClass}>0b</span>
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
            className={inputWithAddon}
            spellCheck={false}
          />
        </div>
      </label>
    </div>
  );
}
