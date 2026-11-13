// Collision queries against the static world: terrain plus structure boxes.
//
// Bodies are upright capsules. Structure colliders are boxes rotated about Y
// only, so in a box's own frame the capsule is still upright and the closest
// point computation is exact and cheap.
//
// `capsuleFree` is the authority on what counts as legal space. Movement,
// spawning, mounting and teleporting must all end in a position it accepts.

import { YAW_UNITS } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import type { Heightfield } from "./heightfield.ts";
import type { StructureStore } from "./structures.ts";

/** Penetration below this depth counts as touching, not overlapping. */
export const SKIN = 0.002;
const YAW_TO_RAD = TAU / YAW_UNITS;

export interface CollisionWorld {
  readonly hf: Heightfield;
  readonly structs: StructureStore;
}

/** Result of the last `capsuleBox` call that returned true: the shortest push out, world space. */
export const push = { x: 0, y: 0, z: 0, depth: 0 };

const refs = new Uint32Array(256);

/**
 * Test an upright capsule (feet at x,y,z; radius r; total height h) against one
 * structure. On overlap deeper than `slack`, fills `push` and returns true.
 */
export function capsuleBox(structs: StructureStore, ref: number, x: number, y: number, z: number, r: number, h: number, slack: number): boolean {
  const t = structs.chunks[Math.floor(ref / 65536)]!;
  const slot = ref & 0xffff;
  const kind = t.kind[slot]!;
  const hx = structs.halfXOf(kind);
  const hy = structs.halfYOf(kind);
  const hz = structs.halfZOf(kind);
  const a = t.yaw[slot]! * YAW_TO_RAD;
  const s = detSin(a);
  const c = detCos(a);

  // Capsule axis in the box frame.
  const dx = x - t.x[slot]!;
  const dz = z - t.z[slot]!;
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  const y0 = y + r - t.y[slot]!;
  let y1 = y + h - r - t.y[slot]!;
  if (y1 < y0) y1 = y0;

  // Closest points between the axis segment and the box.
  const px = lx < -hx ? -hx : lx > hx ? hx : lx;
  const pz = lz < -hz ? -hz : lz > hz ? hz : lz;
  const ex = lx - px;
  const ez = lz - pz;
  let ey = 0;
  if (y1 < -hy) ey = y1 + hy;
  else if (y0 > hy) ey = y0 - hy;
  const d2 = ex * ex + ey * ey + ez * ez;
  const reach = r - slack;
  if (d2 >= reach * reach) return false;

  let ox: number;
  let oy: number;
  let oz: number;
  let depth: number;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    depth = r - d;
    const k = depth / d;
    ox = ex * k;
    oy = ey * k;
    oz = ez * k;
  } else {
    // The axis passes through the box: leave by the nearest face.
    const xp = hx - lx + r;
    const xn = lx + hx + r;
    const zp = hz - lz + r;
    const zn = lz + hz + r;
    const yp = hy - y0 + r;
    const yn = y1 + hy + r;
    depth = xp;
    ox = xp;
    oy = 0;
    oz = 0;
    if (xn < depth) {
      depth = xn;
      ox = -xn;
    }
    if (zp < depth) {
      depth = zp;
      ox = 0;
      oz = zp;
    }
    if (zn < depth) {
      depth = zn;
      ox = 0;
      oz = -zn;
    }
    if (yp < depth) {
      depth = yp;
      ox = 0;
      oz = 0;
      oy = yp;
    }
    if (yn < depth) {
      depth = yn;
      ox = 0;
      oz = 0;
      oy = -yn;
    }
  }
  push.x = c * ox + s * oz;
  push.y = oy;
  push.z = -s * ox + c * oz;
  push.depth = depth;
  return true;
}

/** True when a capsule at this position is inside no terrain and no structure. */
export function capsuleFree(w: CollisionWorld, x: number, y: number, z: number, r: number, h: number): boolean {
  const hf = w.hf;
  if (x < 0 || z < 0 || x > hf.sizeX || z > hf.sizeZ) return false;
  if (y < hf.heightAt(x, z) - SKIN) return false;
  const n = w.structs.query(x - r, z - r, x + r, z + r, refs);
  for (let i = 0; i < n; i++) {
    if (capsuleBox(w.structs, refs[i]!, x, y, z, r, h, SKIN)) return false;
  }
  return true;
}

/** True when the capsule rests on top of a structure: lowering it by `probe` meets an upward push. */
export function restsOnStructure(w: CollisionWorld, x: number, y: number, z: number, r: number, h: number, probe: number): boolean {
  const n = w.structs.query(x - r, z - r, x + r, z + r, refs);
  for (let i = 0; i < n; i++) {
    if (capsuleBox(w.structs, refs[i]!, x, y - probe, z, r, h, 0) && push.y > 0.7 * push.depth) return true;
  }
  return false;
}
