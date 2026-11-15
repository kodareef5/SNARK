// What a body falls on, and the colour of the dust it throws up. A map has no layer of ground kinds yet, so the kind is
// read from what the map has, as the sound work reads it: paved colours are stone, the strip just above the sea is sand,
// a steep slope is bare rock, feet well above the ground stand on something built, and the rest is grass over soil.

import type { Heightfield } from "../../../shared/world/heightfield.ts";

/** The kinds, in the order of shared/pack/details.ts GROUNDS. */
export const GROUND_GRASS = 0;
export const GROUND_SAND = 1;
export const GROUND_STONE = 2;
export const GROUND_WATER = 3;
export const GROUND_BUILT = 4;

/** Palette colours a map paints paving with: the plaza and concrete. */
const PAVED = new Set([1, 2]);
/** Metres above the sea that are beach, where the sea is within SHORE metres. */
const BEACH = 1.5;
const SHORE = 12;
/** The cosine of the slope beyond which ground is bare rock: about 40 degrees. */
const ROCK_SLOPE = 0.77;
/** Dry soil, which grass ground gives as dust, and the dust of a wooden or stone floor. sRGB. */
const SOIL = [138, 115, 86] as const;
const FLOOR_DUST = [168, 159, 143] as const;

/** The kind of ground at (x, z) for a body whose feet are at height `y`. */
export function groundAt(hf: Heightfield, x: number, y: number, z: number): number {
  if (y < hf.seaLevel - 0.1) return GROUND_WATER;
  const h = hf.heightAt(x, z);
  if (y > h + 0.3) return GROUND_BUILT;
  if (PAVED.has(tintAt(hf, x, z))) return GROUND_STONE;
  if (h < hf.seaLevel + BEACH && nearSea(hf, x, z)) return GROUND_SAND;
  return hf.slopeCosAt(x, z) < ROCK_SLOPE ? GROUND_STONE : GROUND_GRASS;
}

/** Whether the sea comes within SHORE metres of (x, z), looked for in eight ways. */
function nearSea(hf: Heightfield, x: number, z: number): boolean {
  for (let k = 0; k < 8; k++) if (hf.heightAt(x + Math.cos(k * 0.785) * SHORE, z + Math.sin(k * 0.785) * SHORE) < hf.seaLevel) return true;
  return false;
}

function tintAt(hf: Heightfield, x: number, z: number): number {
  const i = Math.max(0, Math.min(hf.nx - 1, Math.round(x / hf.cell)));
  const j = Math.max(0, Math.min(hf.nz - 1, Math.round(z / hf.cell)));
  return hf.tint[j * hf.nx + i]!;
}

/**
 * The sRGB colour of the dust thrown up from the ground at (x, z), into `out`: sand and stone lightened a little, grass
 * the colour of dry soil with a little of its green, a floor a pale dust. Water has none and leaves `out` as it was.
 */
export function dustColour(hf: Heightfield, palette: Uint8Array, kind: number, x: number, z: number, out: number[]): boolean {
  if (kind === GROUND_WATER) return false;
  const t = tintAt(hf, x, z) * 4;
  const c = [palette[t]!, palette[t + 1]!, palette[t + 2]!];
  for (let k = 0; k < 3; k++) {
    if (kind === GROUND_BUILT) out[k] = FLOOR_DUST[k]!;
    else if (kind === GROUND_GRASS) out[k] = SOIL[k]! * 0.8 + c[k]! * 0.2 + (255 - SOIL[k]!) * 0.2;
    else out[k] = c[k]! + (255 - c[k]!) * 0.12;
  }
  return true;
}
