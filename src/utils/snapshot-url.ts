import { deflate, Inflate } from 'pako';
import { exportToJson } from './storage';
import type { AppState } from '../types/register';

/** URL-safe base64 encode (replaces +/ with -_, strips =) */
function toUrlSafeBase64(bytes: Uint8Array): string {
  // P-5: Use chunked approach to avoid O(n²) string concatenation
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** URL-safe base64 decode (restores +/ and = padding) */
function fromUrlSafeBase64(encoded: string): Uint8Array {
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function compressSnapshot(jsonString: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonString);
  const compressed = deflate(data);
  return toUrlSafeBase64(compressed);
}

const MAX_COMPRESSED_SIZE = 512 * 1024; // 512 KB
const MAX_DECOMPRESSED_SIZE = 2 * 1024 * 1024; // 2 MB

export function decompressSnapshot(encoded: string): string {
  const compressed = fromUrlSafeBase64(encoded);
  if (compressed.length > MAX_COMPRESSED_SIZE) {
    throw new Error('Compressed snapshot exceeds maximum allowed size');
  }

  let totalSize = 0;
  const chunks: Uint8Array[] = [];
  const inflator = new Inflate();

  inflator.onData = (chunk: Uint8Array) => {
    totalSize += chunk.length;
    if (totalSize > MAX_DECOMPRESSED_SIZE) {
      throw new Error('Decompressed snapshot exceeds maximum allowed size');
    }
    chunks.push(chunk);
  };

  inflator.push(compressed, true);

  if (inflator.err) {
    throw new Error(`Decompression failed: ${inflator.msg}`);
  }

  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(result);
}

export function buildSnapshotUrl(state: AppState): string {
  const json = exportToJson(state);
  const compressed = compressSnapshot(json);
  const base = window.location.href.split('#')[0];
  return `${base}#data=${compressed}`;
}

const PROJECT_HASH_RE = /^#\/p\/[A-Za-z0-9]{12}$/;

export function isSnapshotHash(hash: string): boolean {
  return hash.startsWith('#data=') && hash.length > '#data='.length;
}

export function isProjectHash(hash: string): boolean {
  return PROJECT_HASH_RE.test(hash);
}
