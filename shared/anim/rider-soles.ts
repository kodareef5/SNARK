// Native foot support calibration. Only a change of actual body/look/footwear recomputes these six offsets.
import { B_FOOT_L, B_FOOT_R, B_TOE_L, B_TOE_R, HUMAN_BONES } from "./human.ts";
import { defaultLook, LOOK_BYTES, lookScales } from "./look.ts";

const PLAIN = defaultLook();

/** Lowest native foot/toe vertex relative to each ankle when the fitted foot and toe face forward, +Y up.
 * Points are four model-space xyz witnesses in foot.L, toe.L, foot.R, toe.R order. Positive scales preserve minima. */
export function soleOffsets(points: readonly number[], rest: Float32Array, scale: Float32Array | null, out: Float64Array): boolean {
  if (points.length !== 12 || !points.every(Number.isFinite)) return false;
  for (let side = 0; side < 2; side++) {
    const foot = side === 0 ? B_FOOT_L : B_FOOT_R, toe = side === 0 ? B_TOE_L : B_TOE_R;
    let lowest = Infinity;
    for (let part = 0; part < 2; part++) {
      const bone = part === 0 ? foot : toe, point = (side * 2 + part) * 3;
      const y = (rest[bone * 3 + 1]! - rest[foot * 3 + 1]!) * (scale?.[foot * 3 + 1] ?? 1) + (points[point + 1]! - rest[bone * 3 + 1]!) * (scale?.[bone * 3 + 1] ?? 1);
      if (y >= lowest) continue;
      lowest = y;
      for (let axis = 0; axis < 3; axis++) out[side * 3 + axis] = (rest[bone * 3 + axis]! - rest[foot * 3 + axis]!) * (scale?.[foot * 3 + axis] ?? 1) + (points[point + axis]! - rest[bone * 3 + axis]!) * (scale?.[bone * 3 + axis] ?? 1);
    }
  }
  return [...out].every(Number.isFinite);
}

/** One per live rider; callers invalidate its cached pose when revision changes. Missing calibration is ordinary ankles. */
export class RiderSoles {
  readonly offsets = new Float64Array(6);
  revision = 0;
  private readonly look = new Uint8Array(LOOK_BYTES);
  private readonly scale = new Float32Array(HUMAN_BONES * 3);
  private points: readonly number[] | null = null;
  private rest: Float32Array | null = null;
  private ready = false;
  private valid = false;

  update(points: readonly number[] | null, rest: Float32Array, look: Uint8Array | null, at = 0): Float64Array | null {
    const view = look ?? PLAIN, from = look ? at : 0;
    let same = this.ready && this.points === points && this.rest === rest;
    for (let i = 0; same && i < LOOK_BYTES; i++) same = this.look[i] === view[from + i];
    if (same) return this.valid ? this.offsets : null;
    this.ready = true; this.points = points; this.rest = rest; this.revision++;
    for (let i = 0; i < LOOK_BYTES; i++) this.look[i] = view[from + i]!;
    lookScales(this.look, this.scale, rest);
    this.valid = points !== null && soleOffsets(points, rest, this.scale, this.offsets);
    return this.valid ? this.offsets : null;
  }
}
