// The integer hash the weathering's read and the noises of the textures the card makes share (noise.ts): its GLSL twin
// gives the same bits, so a seed draws the same on either.

/** 32 bits from three whole numbers, each bit as likely as the next. */
export function hash32(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 1597334677) ^ Math.imul(b, 3812015801) ^ Math.imul(c, 2654435761)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A number from 0 to 1 from three whole numbers: hash32's top 24 bits, which a float holds exactly. */
export const hash3 = (a: number, b: number, c: number): number => (hash32(a, b, c) >>> 8) / 16777216;
