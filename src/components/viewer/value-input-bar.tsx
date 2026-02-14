import { useState, useEffect } from 'react';
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

  // Sync display strings from current value
  useEffect(() => {
    setHexInput(value.toString(16).toUpperCase().padStart(Math.ceil(register.width / 4), '0'));
    setBinInput(value.toString(2).padStart(register.width, '0'));
    setDecInput(value.toString(10));
  }, [value, register.width]);

  function commitValue(raw: bigint) {
    const clamped = clampToWidth(raw, register.width);
    dispatch({ type: 'SET_REGISTER_VALUE', registerId: register.id, value: clamped });
  }

  function handleHexBlur() {
    try {
      const v = BigInt('0x' + hexInput.replace(/^0x/i, ''));
      commitValue(v);
    } catch {
      // Revert to current value
      setHexInput(value.toString(16).toUpperCase().padStart(Math.ceil(register.width / 4), '0'));
    }
  }

  function handleBinBlur() {
    try {
      const v = BigInt('0b' + binInput.replace(/^0b/i, ''));
      commitValue(v);
    } catch {
      setBinInput(value.toString(2).padStart(register.width, '0'));
    }
  }

  function handleDecBlur() {
    try {
      const v = BigInt(decInput);
      commitValue(v);
    } catch {
      setDecInput(value.toString(10));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, onBlur: () => void) {
    if (e.key === 'Enter') onBlur();
  }

  const inputClass =
    'flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-lg font-mono shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  const labelClass =
    'text-sm font-semibold text-gray-500 dark:text-gray-400 w-10 shrink-0';

  return (
    <div className="flex flex-col gap-3 mb-4 max-w-2xl">
      <label className="flex items-center gap-2">
        <span className={labelClass}>DEC</span>
        <input
          type="text"
          value={decInput}
          onChange={(e) => setDecInput(e.target.value)}
          onBlur={handleDecBlur}
          onKeyDown={(e) => handleKeyDown(e, handleDecBlur)}
          className={inputClass}
          spellCheck={false}
        />
      </label>
      <label className="flex items-center gap-2">
        <span className={labelClass}>HEX</span>
        <input
          type="text"
          value={'0x' + hexInput}
          onChange={(e) => setHexInput(e.target.value.replace(/^0x/i, ''))}
          onBlur={handleHexBlur}
          onKeyDown={(e) => handleKeyDown(e, handleHexBlur)}
          className={inputClass}
          spellCheck={false}
        />
      </label>
      <label className="flex items-center gap-2">
        <span className={labelClass}>BIN</span>
        <input
          type="text"
          value={'0b' + binInput}
          onChange={(e) => setBinInput(e.target.value.replace(/^0b/i, ''))}
          onBlur={handleBinBlur}
          onKeyDown={(e) => handleKeyDown(e, handleBinBlur)}
          className={inputClass}
          spellCheck={false}
        />
      </label>
    </div>
  );
}
