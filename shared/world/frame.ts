// The frame of a turned piece. Its axes are whole-number vectors on the lattice, near its yaw but not exactly along it and not
// exactly half a side long. Pieces are placed by those vectors, and collision and rays measure a piece's boxes by the same
// vectors, so pieces set half sides apart meet edge to edge at every yaw.

import { STRUCT_UNITS, YAW_UNITS } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";

/** In lattice units. A metre and a half. */
export const HALF_SIDE = (STRUCT_UNITS * 3) / 2;
const QUARTER = YAW_UNITS / 4;
/** No frame makes a box wider than this many times its written size. */
export const STRETCH_MOST = 1 + 1 / HALF_SIDE;

/**
 * The world directions of the +X and +Z axes of a frame turned `yaw`, each as a whole-number vector half a side long, written to
 * `out` as [xX, xZ, zX, zZ]. Frames a quarter turn apart share their vectors exactly, swapped and signed.
 */
export function frameAxes(yaw: number, out: Int32Array): void {
  const quarters = (yaw >>> 14) & 3;
  const within = yaw & (QUARTER - 1);
  // All pieces joined to one first piece share this part of the yaw, so the last result is cached.
  if (within !== lastWithin) {
    const a = within * (TAU / YAW_UNITS);
    lastCos = Math.round(detCos(a) * HALF_SIDE);
    lastSin = Math.round(detSin(a) * HALF_SIDE);
    lastWithin = within;
  }
  let c = lastCos;
  let s = lastSin;
  // A quarter turn takes (c, s) to (-s, c).
  for (let k = 0; k < quarters; k++) {
    const t = c;
    c = -s;
    s = t;
  }
  out[0] = c;
  out[1] = -s;
  out[2] = s;
  out[3] = c;
}

let lastWithin = -1;
let lastCos = 0;
let lastSin = 0;

/**
 * Filled by frameOf. The frame's +X is (cos, -sin) in the world and its +Z is (sin, cos), unit vectors along its whole-number
 * axes. A box in the frame is `stretch` times as wide and as deep as written, and as far from the piece's middle.
 */
export const frame = { cos: 1, sin: 0, stretch: 1 };

const axes = new Int32Array(4);
let frameYaw = 0;

/** Fills `frame` for a piece turned `yaw`. */
export function frameOf(yaw: number): void {
  if (yaw === frameYaw) return;
  frameAxes(yaw, axes);
  const c = axes[0]!;
  const s = axes[2]!;
  const length = Math.sqrt(c * c + s * s);
  frame.cos = c / length;
  frame.sin = s / length;
  frame.stretch = length / HALF_SIDE;
  frameYaw = yaw;
}
