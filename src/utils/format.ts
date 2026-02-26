export function formatOffset(offset: number, minDigits: number = 2): string {
  return '0x' + offset.toString(16).toUpperCase().padStart(minDigits, '0');
}

/** Compute the number of hex digits needed to represent `maxOffset`, minimum 2. */
export function offsetHexDigits(maxOffset: number): number {
  if (maxOffset <= 0) return 2;
  return Math.max(2, maxOffset.toString(16).length);
}

/** Format an ISO date string as a relative timestamp (e.g. "5m ago", "yesterday"). */
export function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHr / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    });
  } catch {
    return dateString;
  }
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
