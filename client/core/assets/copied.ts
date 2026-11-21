// What the data utility's files fetched after the first frame (inspect.ts, look.ts, requests.ts and the monitor's) take
// of the residency's and the textures' code, as copies: a file fetched later that imported a value from the script the
// first frame waits for would have the build cut that script into more pieces, each costing it bytes (D915).
// tests/unit/monitor.test.ts holds each copy to its original.

import type { TextureFormat } from "../../../shared/pack/texture.ts";

/** residency.ts: a slot's states, a material's maps, and why a slot wanted waits. */
export const ABSENT = 0, LOADING = 1, ARRIVED = 2, RESIDENT = 3, DEAD = 4, RIDING = 5, MAPS = 5;
export const WHY_NONE = 0, WHY_LANES = 1, WHY_WAITING = 2, WHY_RETRY = 3, WHY_FIRSTS = 4, WHY_SHARE = 5, WHY_LEVEL = 6, WHY_LARGE = 7, WHY_ALLOWANCE = 8, WHY_FULL = 9;
/** shared/pack/texture.ts: the side of step 0, the last step, and the most the rgba variant holds. */
export const STEP0_SIZE = 64, LAST_STEP = 6, RGBA_TOP = 1024;

/** residency.ts stepFor: the first step whose pictures are at least `px` pixels across, and `most` if none before it is. */
export function stepFor(px: number, most: number): number {
  let step = 0;
  while (step < most && STEP0_SIZE << step < px) step++;
  return step;
}

/** texture.ts stepOf: the step whose side is `size`, or -1 if `size` is not one a texture can have. */
export function stepOf(size: number): number {
  for (let s = 0; s <= LAST_STEP; s++) if (STEP0_SIZE << s === size) return s;
  return -1;
}

/** texture.ts topIn: the top side a texture authored at `top` has in a variant. */
export function topIn(format: TextureFormat, top: number): number {
  return format === "rgba" && top > RGBA_TOP ? RGBA_TOP : top;
}
