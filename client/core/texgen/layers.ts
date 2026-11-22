// The layers of the textures the card makes (texgen, engine.ts), as the lit program's read and the jobs both lay them
// out, and the array's side and bytes on each tier.

import type { Tier } from "../assets/tiers.ts";

/** Metres across a bay's stamp and down one storey, and across a field. */
export const WEATHER_BAY = 8;
export const WEATHER_STOREY = 4;
export const WEATHER_FIELD = 16;
/** The array's layers: the weathering's bays, each two storeys' stamps, then its fields. */
export const WEATHER_BAYS = 6;
export const WEATHER_FIELDS = 2;
export const TEXGEN_LAYERS = WEATHER_BAYS + WEATHER_FIELDS;
/**
 * The share of a storey's rows at its top and its foot that hold its slab line's and its floor's own values, so that no
 * read of one of a layer's two stamps, filtered or anisotropic at any level the weathering is read at, takes the other's.
 */
export const WEATHER_PAD = 1 / 16;

/** Bytes the array holds with layers `side` wide, every level of each: RGBA8, uncompressed. */
export const texgenBytes = (side: number, layers = TEXGEN_LAYERS): number => Math.round((side * side * 4 * layers * 4) / 3);
/**
 * The array's side on a tier whose finishes the card keeps `finishes` wide (0 for none), where it reads them in full:
 * 512, a texel 1.6 cm of a bay's 8 m, finer than a track of runoff; on ultra 1,024. None elsewhere, as on the phones.
 */
export const texgenSide = (tier: Tier, finishes: number): number => (finishes > 0 && tier.finish === "full" ? (tier.finishes >= 2048 ? 1024 : 512) : 0);
