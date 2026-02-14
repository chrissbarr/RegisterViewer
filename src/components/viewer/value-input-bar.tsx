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
    'px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <label className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 dark:text-gray-400 w-8">HEX</span>
        <input
          type="text"
          value={'0x' + hexInput}
          onChange={(e) => setHexInput(e.target.value.replace(/^0x/i, ''))}
          onBlur={handleHexBlur}
          onKeyDown={(e) => handleKeyDown(e, handleHexBlur)}
          className={inputClass + ' w-48'}
          spellCheck={false}
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 dark:text-gray-400 w-8">BIN</span>
        <input
          type="text"
          value={'0b' + binInput}
          onChange={(e) => setBinInput(e.target.value.replace(/^0b/i, ''))}
          onBlur={handleBinBlur}
          onKeyDown={(e) => handleKeyDown(e, handleBinBlur)}
          className={inputClass + ' w-80'}
          spellCheck={false}
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 dark:text-gray-400 w-8">DEC</span>
        <input
          type="text"
          value={decInput}
          onChange={(e) => setDecInput(e.target.value)}
          onBlur={handleDecBlur}
          onKeyDown={(e) => handleKeyDown(e, handleDecBlur)}
          className={inputClass + ' w-40'}
          spellCheck={false}
        />
      </label>
    </div>
  );
}
