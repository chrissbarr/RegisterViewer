const BASE62_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 12;

/**
 * Generate a 12-character base62 ID using crypto.getRandomValues.
 *
 * Each character is selected by generating a random byte and rejecting
 * values >= 248 (the largest multiple of 62 below 256) to avoid modulo bias.
 * This gives a uniform distribution across the 62-character alphabet.
 *
 * 12 base62 characters yield ~71 bits of entropy (log2(62^12) ~ 71.45).
 */
export function generateId(): string {
  const result: string[] = [];
  // Generate extra bytes to account for rejection sampling
  const buf = new Uint8Array(ID_LENGTH * 2);

  while (result.length < ID_LENGTH) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && result.length < ID_LENGTH; i++) {
      // Reject values >= 248 to avoid modulo bias (248 = 62 * 4)
      if (buf[i] < 248) {
        result.push(BASE62_CHARS[buf[i] % 62]);
      }
    }
  }

  return result.join('');
}
