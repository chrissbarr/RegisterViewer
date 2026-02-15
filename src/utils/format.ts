export function formatOffset(offset: number): string {
  return '0x' + offset.toString(16).toUpperCase().padStart(2, '0');
}
