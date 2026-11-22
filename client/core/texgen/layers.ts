// The layers of the textures the card makes (texgen, engine.ts), as the lit program's read and the jobs both lay them
// out, and the array's side and bytes on each tier.

import type { Tier } from "../assets/tiers.ts";

/** Metres across a bay's stamp and down one storey; across a field's tile and up it; across and up the formwork's tile. */
export const WEATHER_BAY = 8;
export const WEATHER_STOREY = 4;
export const WEATHER_FIELD = 16;
export const WEATHER_FIELD_UP = 8;
export const FORMWORK = 2;
/**
 * The array's layers: the stamps of the storeys over the ground, two a layer; the ground storey's; the field's two
 * tiles; and the formwork's tile.
 */
export const WEATHER_BAYS = 6;
export const WEATHER_GROUND = 3;
export const FIELD_LAYER = WEATHER_BAYS + WEATHER_GROUND;
export const FORMWORK_LAYER = FIELD_LAYER + 1;
export const TEXGEN_LAYERS = FORMWORK_LAYER + 1;
/** Metres over the ground under which a ground storey's stain is growth, and over which it is rust. */
export const GROWTH_TOP = 0.6;
/**
 * The share of a storey's rows at its top and its foot that hold its slab line's and its floor's own values, so that no
 * read of one of a layer's two stamps, filtered or anisotropic at any level the weathering is read at, takes the other's.
 */
export const WEATHER_PAD = 1 / 16;

/** Bytes the array holds with layers `side` wide, every level of each: RGBA8, uncompressed. */
export const texgenBytes = (side: number, layers = TEXGEN_LAYERS): number => Math.round((side * side * 4 * layers * 4) / 3);
/** The most the array may hold on the card, every level of every layer; a new job's layers come out of it. */
export const TEXGEN_BUDGET = 16 * 1024 * 1024;
/**
 * The array's side on a tier whose finishes the card keeps `finishes` wide (0 for none), where it reads them in full:
 * 512, a texel 1.6 cm of a bay's 8 m, finer than a track of runoff, or the widest under it that holds `layers` within
 * TEXGEN_BUDGET; none under 256, and none on the other tiers, as on the phones.
 */
export function texgenSide(tier: Tier, finishes: number, layers = TEXGEN_LAYERS): number {
  if (finishes <= 0 || tier.finish !== "full") return 0;
  let side = 512;
  while (side >= 256 && texgenBytes(side, layers) > TEXGEN_BUDGET) side >>= 1;
  return side >= 256 ? side : 0;
}
