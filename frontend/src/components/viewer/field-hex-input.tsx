import React, { useState, useEffect } from 'react';
import type { Field } from '../../types/register';
import { useAppDispatch } from '../../context/app-context';

interface Props {
  field: Field;
  registerId: string;
  registerValue: bigint;
  gridColumn: string; 
  gridRow?: number;
  bgColor: string;    
  borderColor: string;
}

export function FieldHexInput({ field, registerId, registerValue, gridColumn, gridRow, bgColor, borderColor }: Props) {
  const dispatch = useAppDispatch();
  
  const width = field.msb - field.lsb + 1;
  const mask = (1n << BigInt(width)) - 1n;
  const currentValue = (registerValue >> BigInt(field.lsb)) & mask;

  const [inputVal, setInputVal] = useState(currentValue.toString(16).toUpperCase());

  useEffect(() => {
    setInputVal(currentValue.toString(16).toUpperCase());
  }, [currentValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9A-Fa-f]/g, '');
    setInputVal(val);
    
    try {
      if (val === '') return;
      const newVal = BigInt('0x' + val);
      if (newVal > mask) return; 

      const clearMask = ~(mask << BigInt(field.lsb));
      const clearedRegister = registerValue & clearMask;
      const newBits = (newVal << BigInt(field.lsb));
      const newRegisterValue = clearedRegister | newBits;
      
      dispatch({
        type: 'SET_REGISTER_VALUE',
        registerId,
        value: newRegisterValue
      });
    } catch {
      // Ignore
    }
  };

  const handleBlur = () => {
    const hexLen = Math.ceil(width / 4);
    const formatted = currentValue.toString(16).toUpperCase().padStart(hexLen, '0');
    setInputVal(formatted);
  };

  return (
    <div
      className="flex items-center justify-center h-8 border-t border-gray-200 dark:border-gray-700 transition-colors duration-150"
      style={{
        gridColumn,
        gridRow, 
        backgroundColor: bgColor,
        borderBottom: `2px solid ${borderColor}`, 
        borderLeft: `2px solid ${borderColor}`,   
        borderRight: `2px solid ${borderColor}`, 
      }}
    >
      <div className="relative w-full h-full flex items-center justify-center">
        <span className="absolute left-1 text-[9px] text-gray-400 font-mono select-none pointer-events-none">
          0x
        </span>
        <input
          type="text"
          value={inputVal}
          onChange={handleChange}
          onBlur={handleBlur}
          className="w-full h-full pl-4 pr-1 text-xs font-mono text-center bg-transparent focus:outline-none focus:bg-white/10 dark:focus:bg-black/20 rounded-sm"
          title={`Edit ${field.name}`}
        />
      </div>
    </div>
  );
}