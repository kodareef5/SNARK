// Which materials made from recipes the card holds (materials.ts): the array has a few slots of two layers, and the
// materials nearest the eye take them. A material with no slot, or whose slot is not yet made, is drawn as its
// finish's means, which every material is far off, so a slot changing hands is never seen. The frame is told each
// material's layer and how far it has come up (packet.ts fMade); the engine is told the version wanted of each layer.

import { MATERIAL_RECIPES } from "../../../content/texgen/materials.ts";
import { MADE_LAYER, MADE_SLOTS, TEXGEN_LAYERS } from "./layers.ts";

/** Floats a material has in the frame's block: its slot's first layer (-1 for none), how far it has come up, two spare; then where the eye is in its tiles along x, y and z, less whole tiles. */
export const MADE_FLOATS = 8;
/** Frames over which a slot's material comes up once it is made. */
export const MADE_RISE = 20;
/** A material in a slot is taken as this much nearer than it is, so that two a like distance off do not trade a slot. */
const KEEP = 0.8;

/** Each material's place in its tiles for an eye at (x, y, z), into `out` from `at` as fMade has it. */
export function madePhase(out: Float32Array, at: number, x: number, y: number, z: number): void {
  for (let k = 0; k < MATERIAL_RECIPES.length; k++) {
    const m = MATERIAL_RECIPES[k]!.metres, o = at + k * MADE_FLOATS + 4;
    out[o] = x / m - Math.floor(x / m);
    out[o + 1] = y / m - Math.floor(y / m);
    out[o + 2] = z / m - Math.floor(z / m);
  }
}

export class MadeSlots {
  /** The version wanted of each layer of the array (engine.ts Texgen.frame): 1 for the weathering's, a slot's material's number for its two, 0 for an empty slot's. */
  readonly want = new Int32Array(TEXGEN_LAYERS).fill(1).fill(0, MADE_LAYER);
  /** The material in each slot, from 1; 0 for none. Frames since each was made. */
  private readonly slot = new Uint8Array(MADE_SLOTS);
  private readonly risen = new Uint8Array(MADE_SLOTS);
  private readonly rank = new Float32Array(MATERIAL_RECIPES.length);

  /**
   * A frame: `near` is metres from the eye to the nearest piece of each material (Infinity for none in reach), `holds`
   * the version each layer holds on the card (Texgen.holds), or null where nothing is made. Writes fMade's slots into
   * `out` from `at`.
   */
  frame(near: ArrayLike<number>, holds: ArrayLike<number> | null, out: Float32Array, at: number): void {
    const K = MATERIAL_RECIPES.length, rank = this.rank;
    for (let k = 0; k < K; k++) rank[k] = near[k]!;
    for (let s = 0; s < MADE_SLOTS; s++) if (this.slot[s]! > 0) rank[this.slot[s]! - 1]! *= KEEP;
    // The nearest material without a slot takes an empty one, or that of the farthest one farther than it.
    for (let turn = 0; turn < MADE_SLOTS; turn++) {
      let best = -1;
      for (let k = 0; k < K; k++) if (rank[k]! < Infinity && !this.slot.includes(k + 1) && (best < 0 || rank[k]! < rank[best]!)) best = k;
      if (best < 0) break;
      let to = -1, far = rank[best]!;
      for (let s = 0; s < MADE_SLOTS; s++) {
        const d = this.slot[s]! > 0 ? rank[this.slot[s]! - 1]! : Infinity;
        if (d > far) {
          to = s;
          far = d;
        }
      }
      if (to < 0) break;
      this.slot[to] = best + 1;
      this.risen[to] = 0;
      this.want[MADE_LAYER + to * 2] = this.want[MADE_LAYER + to * 2 + 1] = best + 1;
    }
    for (let k = 0; k < K; k++) out[at + k * MADE_FLOATS] = -1, out[at + k * MADE_FLOATS + 1] = 0;
    for (let s = 0; s < MADE_SLOTS; s++) {
      const k = this.slot[s]!, layer = MADE_LAYER + s * 2;
      if (k === 0) continue;
      this.risen[s] = holds && holds[layer] === k && holds[layer + 1] === k ? Math.min(MADE_RISE, this.risen[s]! + 1) : 0;
      out[at + (k - 1) * MADE_FLOATS] = layer;
      out[at + (k - 1) * MADE_FLOATS + 1] = this.risen[s]! / MADE_RISE;
    }
  }
}
