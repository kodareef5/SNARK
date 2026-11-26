// What a foot comes down on. A map has no layer of ground kinds yet, so the kind is read from what the map has: its
// paved colours are stone, the strip just above the sea is sand, a steep slope is bare rock, and the rest is grass. A
// map that gains such a layer is read here and nowhere else.

import type { Heightfield } from "../../../shared/world/heightfield.ts";

export const GROUND_GRASS = 0;
export const GROUND_SAND = 1;
export const GROUND_STONE = 2;
export const GROUND_WATER = 3;
/** Sound names of each kind of ground, as a footstep's sound is named: `step/sand`. */
export const GROUND_NAMES: readonly string[] = ["grass", "sand", "stone", "water"];

/** Palette colours a map paints paving with (shared/pack/palette.ts): the plaza and concrete. */
const PAVED = new Set([1, 2]);
/** Metres above the sea that are beach. */
const BEACH = 1.5;
/** The cosine of the slope beyond which ground is bare rock: about 40 degrees. */
const ROCK_SLOPE = 0.77;

/** Whether the map paves (x, z): a street or a plaza, as in a ruined city. */
export function paved(hf: Heightfield, x: number, z: number): boolean {
  const i = Math.max(0, Math.min(hf.nx - 1, Math.round(x / hf.cell)));
  const j = Math.max(0, Math.min(hf.nz - 1, Math.round(z / hf.cell)));
  return PAVED.has(hf.tintOf(i, j));
}

/** The kind of ground at (x, z), for a body whose feet are at height `y`. */
export function groundAt(hf: Heightfield, x: number, y: number, z: number): number {
  if (y < hf.waterAt(x, z) - 0.1) return GROUND_WATER;
  const i = Math.max(0, Math.min(hf.nx - 1, Math.round(x / hf.cell)));
  const j = Math.max(0, Math.min(hf.nz - 1, Math.round(z / hf.cell)));
  if (PAVED.has(hf.tintOf(i, j))) return GROUND_STONE;
  // Feet well above the ground stand on something built.
  const h = hf.heightAt(x, z);
  if (y > h + 0.3) return GROUND_STONE;
  if (h < hf.seaLevel + BEACH) return GROUND_SAND;
  return hf.slopeCosAt(x, z) < ROCK_SLOPE ? GROUND_STONE : GROUND_GRASS;
}
