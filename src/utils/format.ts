export function formatOffset(offset: number): string {
  return '0x' + offset.toString(16).toUpperCase().padStart(2, '0');
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
