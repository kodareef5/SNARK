// The frame of a turned piece. Its axes are whole-number vectors on the lattice, near its yaw but not exactly along it and not
// exactly half a side long. Pieces are placed by those vectors, and collision and rays measure a piece's boxes by the same
// vectors, so pieces set half sides apart meet edge to edge at every yaw.

import { STRUCT_UNITS, YAW_UNITS } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";

/** In lattice units. A metre and a half. */
export const HALF_SIDE = (STRUCT_UNITS * 3) / 2;
const QUARTER = YAW_UNITS / 4;
/** No frame of any turn class makes a box wider than this many times its written size. */
export const STRETCH_MOST = 1 + 2 / HALF_SIDE;

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

const HALF_ROOT3 = 0.8660254037844386;

function roundOut(v: number): number {
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

/**
 * The whole-number vector (x, z) turned 30° toward +Z, to `out[at]` and `out[at + 1]`. Rounding is the same either side
 * of zero, so this commutes exactly with quarter turns.
 */
export function turn30(x: number, z: number, out: Int32Array, at: number): void {
  out[at] = roundOut(HALF_ROOT3 * x - 0.5 * z);
  out[at + 1] = roundOut(0.5 * x + HALF_ROOT3 * z);
}

/**
 * The vector (x, z) turned 60° toward +Z as the lattice turns it: itself plus the quarter turn of its 30° turn. A triangle
 * drawn on a vector and this one has two whole-number sides, and six of them close a ring.
 */
export function turn60(x: number, z: number, out: Int32Array, at: number): void {
  turn30(x, z, out, at);
  const tx = out[at]!;
  out[at] = x - out[at + 1]!;
  out[at + 1] = z + tx;
}

const classAxes = new Int32Array(4);

/**
 * The +X axis of a piece of yaw `yaw` and turn class `tw`, one half-side long, to `out[at]` and `out[at + 1]`. Its +Z axis
 * is that turned a quarter toward +Z, (-z, x). Class 0 is frameAxes' own; 1 and 2 are it turned 30° and 60° on the lattice.
 */
export function classAxis(yaw: number, tw: number, out: Int32Array, at: number): void {
  frameAxes(yaw, classAxes);
  const x = classAxes[0]!;
  const z = classAxes[1]!;
  if (tw === 0) {
    out[at] = x;
    out[at + 1] = z;
  } else if (tw === 1) turn30(x, z, out, at);
  else turn60(x, z, out, at);
}

/**
 * The second axis of a triangle of yaw `yaw` and class `tw`: the lattice direction 60° on from its +X. Only for class 0
 * is that turn60 of its +X.
 */
export function classAxis60(yaw: number, tw: number, out: Int32Array, at: number): void {
  frameAxes(yaw, classAxes);
  const x = classAxes[0]!;
  const z = classAxes[1]!;
  if (tw === 0) turn60(x, z, out, at);
  else if (tw === 1) {
    out[at] = -z;
    out[at + 1] = x;
  } else turn30(-z, x, out, at);
}

/**
 * Filled by frameOf. The frame's +X is (cos, -sin) in the world and its +Z is (sin, cos), unit vectors along its whole-number
 * axes. A box in the frame is `stretch` times as wide and as deep as written, and as far from the piece's middle.
 */
export const frame = { cos: 1, sin: 0, stretch: 1 };

const axes = new Int32Array(4);
let frameYaw = 0;
let frameTw = 0;

/** Fills `frame` for a piece turned `yaw`, of turn class `tw`: 0 for a row that is not on a base's lattice. */
export function frameOf(yaw: number, tw: number): void {
  if (yaw === frameYaw && tw === frameTw) return;
  if (tw === 0) frameAxes(yaw, axes);
  else {
    classAxis(yaw, tw, axes, 0);
    axes[2] = -axes[1]!;
  }
  const c = axes[0]!;
  const s = axes[2]!;
  const length = Math.sqrt(c * c + s * s);
  frame.cos = c / length;
  frame.sin = s / length;
  frame.stretch = length / HALF_SIDE;
  frameYaw = yaw;
  frameTw = tw;
}
