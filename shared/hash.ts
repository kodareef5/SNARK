// FNV-1a, 32 bit. Used to detect mismatched content, maps and packs, and to
// compare simulation state in tests. Not a security primitive.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function hashBytes(data: Uint8Array, seed: number = FNV_OFFSET): number {
  let h = seed >>> 0;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

export function hashString(s: string, seed: number = FNV_OFFSET): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h ^= c & 0xff;
    h = Math.imul(h, FNV_PRIME);
    h ^= c >>> 8;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}
