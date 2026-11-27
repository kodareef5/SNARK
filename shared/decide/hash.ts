// FNV-1a, 32 bit, over a string: each character's low byte, then its high byte. A copy of shared/hash.ts's hashString,
// kept here so the engine imports nothing outside its own folder and can be lifted out whole.

const OFFSET = 0x811c9dc5;
const PRIME = 0x01000193;

export function hashString(s: string): number {
  let h = OFFSET;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h = Math.imul(h ^ (c & 0xff), PRIME);
    h = Math.imul(h ^ (c >>> 8), PRIME);
  }
  return h >>> 0;
}
