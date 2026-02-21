export function formatOffset(offset: number, minDigits: number = 2): string {
  return '0x' + offset.toString(16).toUpperCase().padStart(minDigits, '0');
}

/** Compute the number of hex digits needed to represent `maxOffset`, minimum 2. */
export function offsetHexDigits(maxOffset: number): number {
  if (maxOffset <= 0) return 2;
  return Math.max(2, maxOffset.toString(16).length);
}

/**
 * Insert a space every 4 characters from the right for binary readability.
 * Example: "110101101011" → "1101 0110 1011"
 */
export function formatBinary(binStr: string): string {
  if (!binStr) return '';
  const parts: string[] = [];
  let i = binStr.length;
  while (i > 0) {
    const start = Math.max(0, i - 4);
    parts.unshift(binStr.slice(start, i));
    i = start;
  }
  return parts.join(' ');
}
