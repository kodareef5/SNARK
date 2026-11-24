// From the lattice to the world, in whole lattice units (1/512 m). A frame turned `yaw` has four whole-number vectors (x, z):
// a0 is its +X axis as frameAxes gives it, a1 is a0 turned 30° and rounded, a2 = a0 + R(a1) and a3 = R(a0), where
// R(x, z) = (-z, x) is the quarter turn from +X toward +Z. A tuple's place is origin + Σ mi·ai: linear, so what closes as
// tuples closes in the world at every yaw. A place is within DRIFT_MOST·√(m1² + m2²) units of its ideal place in the
// frame's own axes, so two patches the ideal test calls a hair apart can be centimetres apart or overlapped when far along ζ and ζ².

import { STRUCT_UNITS, YAW_UNITS } from "../../coords.ts";
import { frameAxes, turn30 } from "../frame.ts";
import type { Tuples } from "./module.ts";

export { CLASS_STRETCH_MOST, classAxis, classAxis60, turn30, turn60 } from "../frame.ts";

/** Yaw units in a quarter turn. A quarter turn of direction, three steps, is this much less yaw. */
export const QUARTER_YAW = YAW_UNITS / 4;
/** Lattice units in one level, a quarter storey (0.75 m). */
export const LEVEL_UNITS = (STRUCT_UNITS * 3) / 4;
/** Lattice units a place may be from its ideal place, for each half-side its tuple goes along ζ or ζ² (measured: 0.7015). */
export const DRIFT_MOST = 0.71;

const axes = new Int32Array(4);

/** The four vectors of a frame turned `yaw`, to `out` as [a0x, a0z, a1x, a1z, a2x, a2z, a3x, a3z]. */
export function basisOf(yaw: number, out: Int32Array): void {
  frameAxes(yaw, axes);
  const x = axes[0]!;
  const z = axes[1]!;
  out[0] = x;
  out[1] = z;
  turn30(x, z, out, 2);
  out[4] = x - out[3]!;
  out[5] = z + out[2]!;
  out[6] = -z;
  out[7] = x;
}

/** The world vector of direction `d`, one half-side long, to `out[at]` and `out[at + 1]`: a[d mod 3] turned by R, d div 3 times. */
export function dirVector(basis: Int32Array, d: number, out: Int32Array, at: number): void {
  const quarters = Math.floor(d / 3);
  const i = (d - quarters * 3) * 2;
  let x = basis[i]!;
  let z = basis[i + 1]!;
  for (let k = 0; k < quarters; k++) {
    const t = x;
    x = -z;
    z = t;
  }
  out[at] = x;
  out[at + 1] = z;
}

/** The world x and z of a tuple in a frame with this basis and origin, to `out[at]` and `out[at + 1]`. */
export function worldOf(basis: Int32Array, ox: number, oz: number, m: Tuples, mi: number, out: Int32Array, at: number): void {
  const m0 = m[mi]!;
  const m1 = m[mi + 1]!;
  const m2 = m[mi + 2]!;
  const m3 = m[mi + 3]!;
  out[at] = ox + m0 * basis[0]! + m1 * basis[2]! + m2 * basis[4]! + m3 * basis[6]!;
  out[at + 1] = oz + m0 * basis[1]! + m1 * basis[3]! + m2 * basis[5]! + m3 * basis[7]!;
}

/** The world height of level `lvl` in a frame whose level 0 is at `oy`. */
export function levelY(oy: number, lvl: number): number {
  return oy + lvl * LEVEL_UNITS;
}

/** The yaw of a piece whose +X is direction `d` in a frame turned `frameYaw`. */
export function yawOf(frameYaw: number, d: number): number {
  return (frameYaw - Math.floor(d / 3) * QUARTER_YAW) & (YAW_UNITS - 1);
}

/** The turn class of a piece whose +X is direction `d`: 0 for a frame's own squares, 1 and 2 for those 30° and 60° on. */
export function twOf(d: number): number {
  return d % 3;
}

/** The direction of a piece of yaw `yaw` and class `tw` in a frame turned `frameYaw`, a whole number of quarter turns away. */
export function dirOf(frameYaw: number, yaw: number, tw: number): number {
  return (((frameYaw - yaw) >> 14) & 3) * 3 + tw;
}
