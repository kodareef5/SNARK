// Temporary, with the adoption shim of structures.ts: the key a pose means in a frame, for pieces still set down by pose.
// Delete this file with the shim, once placing, the wire and the save speak keys.

import { YAW_UNITS } from "../../coords.ts";
import { LEVEL_UNITS, QUARTER_YAW, dirVector } from "./basis.ts";
import type { FormTable } from "./forms.ts";
import { rotsOf, type Frame, type LatticeKey } from "./frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, DIRECTIONS, LVL_MOST, M_MOST, SIDE, canon, canonical, dirTurn, key0, key1, tupleSet, tupleStep, tupleWithin } from "./module.ts";

const m = new Int32Array(4);
const v = new Int32Array(2);

export const KEY_NONE = 0;
export const KEY_FOUND = 1;
/** The pose is a slot's in plan and in turn, and between two levels. */
export const KEY_BETWEEN = 2;

/**
 * The key by which poseOf gives a piece of `kind` the pose (x, y, z) lattice units and `yaw` in frame `f`, to `out`, as a
 * KEY_ answer. Only for a piece a whole number of quarter turns from its frame: one on ζ or ζ² has no key here.
 */
export function keyOfPose(f: Frame, forms: FormTable, kind: number, x: number, y: number, z: number, yaw: number, out: LatticeKey): number {
  const away = (f.yaw - yaw) & (YAW_UNITS - 1);
  if ((away & (QUARTER_YAW - 1)) !== 0) return KEY_NONE;
  // The piece's +X is direction 3·quarters.
  const quarters = away / QUARTER_YAW;
  const own = 3 * quarters;
  const cls = forms.cls[kind]!;
  const side = forms.size[kind]!;
  // An edge along the piece's +X is named along it or against it. A square or a vertex of a frame's own is named along 0.
  let dir = cls === CLS_EDGE ? own % 6 : 0;
  const step = DIRECTIONS / rotsOf(forms, kind);
  if (cls !== CLS_TRIANGLE && dirTurn(dir, -own) % step !== 0) return KEY_NONE;
  let rot = dirTurn(dir, -own) / step;
  const lvl = (y - forms.atY[kind]! - f.oy) / LEVEL_UNITS;
  if (Math.abs(lvl) > LVL_MOST) return KEY_NONE;
  // The slot's reference point, which is m0·a0 + m3·a3 from the origin: two vectors square to each other and as long.
  dirVector(f.basis, cls === CLS_TRIANGLE ? own : dir, v, 0);
  const i = forms.atI[kind]!;
  const j = forms.atJ[kind]!;
  const dx = x - i * v[0]! + j * v[1]! - f.ox;
  const dz = z - i * v[1]! - j * v[0]! - f.oz;
  const ax = f.basis[0]!;
  const az = f.basis[1]!;
  const m0 = (dx * ax + dz * az) / (ax * ax + az * az);
  const m3 = (dz * ax - dx * az) / (ax * ax + az * az);
  if (!Number.isInteger(m0) || !Number.isInteger(m3)) return KEY_NONE;
  tupleSet(m, 0, m0, 0, 0, m3);
  if (cls === CLS_TRIANGLE) {
    // Named from its corner `turn`, its own +X is 4·turn on from its cell's direction.
    canonical(cls, m, 0, own, m, 0, side);
    dir = canon.dir;
    rot = (3 - canon.turn) % 3;
  } else if (cls === CLS_EDGE) tupleStep(m, 0, dir, -SIDE / 2, m, 0);
  else if (cls === CLS_SQUARE && side === SIDE) {
    tupleStep(m, 0, dir, -SIDE / 2, m, 0);
    tupleStep(m, 0, dirTurn(dir, 3), -SIDE / 2, m, 0);
  }
  if (!tupleWithin(m, 0, M_MOST)) return KEY_NONE;
  if (!Number.isInteger(lvl)) return KEY_BETWEEN;
  out.fr = f.gid;
  out.k0 = key0(cls, m[0]!, m[1]!, m[2]!);
  out.k1 = key1(m[3]!, lvl, dir, forms.layer[kind]!, rot, 0);
  return KEY_FOUND;
}
