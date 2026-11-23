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
 * tiles; the formwork's tile; and the slots of the materials made from recipes (materials.ts), two layers each, its
 * base colour and its relief, which hold the materials nearest the eye (MadeSlots).
 */
export const WEATHER_BAYS = 6;
export const WEATHER_GROUND = 3;
export const FIELD_LAYER = WEATHER_BAYS + WEATHER_GROUND;
export const FORMWORK_LAYER = FIELD_LAYER + 1;
export const MADE_LAYER = FORMWORK_LAYER + 1;
export const MADE_SLOTS = 4;
export const TEXGEN_LAYERS = MADE_LAYER + 2 * MADE_SLOTS;
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
export const TEXGEN_BUDGET = 26 * 1024 * 1024;
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

/**
 * What a wall's read and the frame need of each material made from a recipe (content/texgen/materials.ts), in the
 * recipes' order, pinned here so that the first frame holds no recipe: its name, its tile's side in metres, its relief
 * in millimetres, how far the world's mottle moves it, the metres it goes to its means over and how far its second
 * copy is moved in its tiles (world-surfaces.ts madeFar, madeShift), whether it lies on a roof alone, and whether it is
 * a coat. A test says when a row is stale.
 */
export const MADE_READS: readonly { readonly name: string; readonly metres: number; readonly relief: number; readonly mottle: number; readonly far: number; readonly shift: readonly [number, number]; readonly lies: boolean; readonly coat: boolean }[] = [
  { name: "stucco", metres: 2, relief: 7, mottle: 0.05, far: 2, shift: [0.37, 0.71], lies: false, coat: true },
  { name: "render", metres: 2, relief: 3, mottle: 0.04, far: 2, shift: [0.37, 0.71], lies: false, coat: true },
  { name: "block", metres: 1.6, relief: 9, mottle: 0.05, far: 0.8, shift: [0.25, 0.75], lies: false, coat: false },
  { name: "corrugated", metres: 1.524, relief: 18, mottle: 0.05, far: 0.3048, shift: [0.35, 0.71], lies: false, coat: false },
  { name: "seam", metres: 2, relief: 25, mottle: 0.04, far: 2, shift: [0.25, 0.71], lies: false, coat: false },
  { name: "gravel", metres: 2, relief: 12, mottle: 0.1, far: 2, shift: [0.37, 0.71], lies: true, coat: false },
];
/** The most materials there may be: a face's key and a look's bits keep room for these (shared/world/city.ts, render/finish-near.ts). */
export const MOST_MATERIALS = 12;
/** A material's number in a face's key and on the card: its place in the recipes and one; 0 for none. */
export const materialIndex = (name: string | undefined): number => (name ? MADE_READS.findIndex((r) => r.name === name) + 1 : 0);

/** Floats a material has in the frame's block: its slot's first layer (-1 for none), how far it has come up, two spare; then where the eye is in its tiles along x, y and z, less whole tiles. */
export const MADE_FLOATS = 8;
/** Each material's place in its tiles for an eye at (x, y, z), into `out` from `at` as fMade has it. */
export function madePhase(out: Float32Array, at: number, x: number, y: number, z: number): void {
  for (let k = 0; k < MADE_READS.length; k++) {
    const m = MADE_READS[k]!.metres, o = at + k * MADE_FLOATS + 4;
    out[o] = x / m - Math.floor(x / m);
    out[o + 1] = y / m - Math.floor(y / m);
    out[o + 2] = z / m - Math.floor(z / m);
  }
}
/** No material holds a slot, into `out` from `at` as fMade has it: what a frame says until the slots' keeper has come (slots.ts). */
export function noMade(out: Float32Array, at: number): void {
  for (let k = 0; k < MADE_READS.length; k++) out[at + k * MADE_FLOATS] = -1, out[at + k * MADE_FLOATS + 1] = 0;
}
