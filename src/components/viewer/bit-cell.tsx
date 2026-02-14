interface Props {
  bitIndex: number;
  bitValue: 0 | 1;
  fieldColor: string | null; // tailwind bg class or null for unassigned
  fieldName: string | null;
  onClick: () => void;
}

export function BitCell({ bitIndex, bitValue, fieldColor, fieldName, onClick }: Props) {
  const bgClass = fieldColor
    ? `${fieldColor} bg-opacity-30 dark:bg-opacity-30`
    : 'bg-gray-100 dark:bg-gray-800';

  return (
    <button
      onClick={onClick}
      title={fieldName ? `Bit ${bitIndex} (${fieldName})` : `Bit ${bitIndex}`}
      className={`flex flex-col items-center justify-center w-8 h-12 border border-gray-300 dark:border-gray-600 text-xs cursor-pointer hover:brightness-110 transition-all select-none ${bgClass}`}
    >
      <span className="text-[10px] text-gray-500 dark:text-gray-400 leading-none">{bitIndex}</span>
      <span className="font-bold text-sm leading-none mt-0.5">{bitValue}</span>
    </button>
  );
}
