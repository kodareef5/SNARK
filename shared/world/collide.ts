// Bodies are upright capsules and structure boxes turn about Y only, so the closest-point test in a box's frame is exact.
// capsuleFree is the authority on legal space. Movement, spawning, mounting and teleporting must all end in a position it accepts.

import { YAW_UNITS } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import type { Heightfield } from "./heightfield.ts";
import { Found, type PartTable, type StructureStore } from "./structures.ts";

/** Penetration below this depth counts as touching, not overlapping. */
export const SKIN = 0.002;
const YAW_TO_RAD = TAU / YAW_UNITS;

export interface CollisionWorld {
  readonly hf: Heightfield;
  readonly structs: StructureStore;
  /** Resource nodes near a body, as boxes like structures (shared/world/nodes.ts). */
  readonly nodes?: StructureStore;
}

/** The shortest push out, in world space, from the last capsuleBox call that returned true. */
export const push = { x: 0, y: 0, z: 0, depth: 0 };

const found = new Found();
/** Metres added to a cheap reject, so that rounding never rejects a touch. */
export const PAD = 0.01;

/**
 * The capsule stands with its feet at (x, y, z), radius r and total height h. On an overlap deeper than `slack`, fills `push`
 * with the way out of the box it is deepest in and returns true.
 */
export function capsuleBox(structs: StructureStore, ref: number, x: number, y: number, z: number, r: number, h: number, slack: number): boolean {
  const t = structs.chunks[Math.floor(ref / 65536)]!;
  const slot = ref & 0xffff;
  const kind = t.kind[slot]!;
  if (structs.isSoft(kind)) return false;
  // Too far off sideways to touch at any yaw. Most of a grid cell's structures are.
  const dx = x - t.x[slot]!;
  const dz = z - t.z[slot]!;
  const far = structs.spread[kind]! + r + PAD;
  if (dx * dx + dz * dz >= far * far) return false;
  return capsuleKind(structs.parts, kind, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, x, y, z, r, h, slack);
}

/** The same test against a structure of `kind` at (sx, sy, sz) facing `syaw`, built or not, to check a piece before it is built. */
export function capsuleKind(parts: PartTable, kind: number, sx: number, sy: number, sz: number, syaw: number, x: number, y: number, z: number, r: number, h: number, slack: number): boolean {
  const a = syaw * YAW_TO_RAD;
  const s = detSin(a);
  const c = detCos(a);
  // The capsule's axis in the structure's frame.
  const dx = x - sx;
  const dz = z - sz;
  const fx = c * dx - s * dz;
  const fz = s * dx + c * dz;
  const fy0 = y + r - sy;
  const fy1 = h > 2 * r ? y + h - r - sy : fy0;
  const reach = r - slack;
  const box = parts.box;
  let found = false;
  let deepest = 0;
  let bx = 0;
  let by = 0;
  let bz = 0;
  for (let p = parts.start[kind]! * 6, end = parts.start[kind + 1]! * 6; p < end; p += 6) {
    const hx = box[p + 3]!;
    const hy = box[p + 4]!;
    const hz = box[p + 5]!;
    // The axis relative to this box's centre.
    const lx = fx - box[p]!;
    const lz = fz - box[p + 2]!;
    const y0 = fy0 - box[p + 1]!;
    const y1 = fy1 - box[p + 1]!;

    // Closest points between the axis segment and the box.
    const px = lx < -hx ? -hx : lx > hx ? hx : lx;
    const pz = lz < -hz ? -hz : lz > hz ? hz : lz;
    const ex = lx - px;
    const ez = lz - pz;
    let ey = 0;
    if (y1 < -hy) ey = y1 + hy;
    else if (y0 > hy) ey = y0 - hy;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 >= reach * reach) continue;

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
      // The axis passes through the box, so leave by the nearest face.
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
    if (found && depth <= deepest) continue;
    found = true;
    deepest = depth;
    bx = ox;
    by = oy;
    bz = oz;
  }
  if (!found) return false;
  push.x = c * bx + s * bz;
  push.y = by;
  push.z = -s * bx + c * bz;
  push.depth = deepest;
  return true;
}

/** True when the capsule is inside the map and overlaps no terrain, structure or node. */
export function capsuleFree(w: CollisionWorld, x: number, y: number, z: number, r: number, h: number): boolean {
  const hf = w.hf;
  if (x < 0 || z < 0 || x > hf.sizeX || z > hf.sizeZ) return false;
  if (y < hf.heightAt(x, z) - SKIN) return false;
  const top = y + (h > 2 * r ? h : 2 * r) + PAD;
  const n = w.structs.query(x - r, z - r, x + r, z + r, found, y - PAD, top);
  for (let i = 0; i < n; i++) {
    if (capsuleBox(w.structs, found.refs[i]!, x, y, z, r, h, SKIN)) return false;
  }
  const nodes = w.nodes;
  if (nodes) {
    const m = nodes.query(x - r, z - r, x + r, z + r, found, y - PAD, top);
    for (let i = 0; i < m; i++) {
      if (capsuleBox(nodes, found.refs[i]!, x, y, z, r, h, SKIN)) return false;
    }
  }
  return true;
}

/** True when lowering the capsule by `probe` meets an upward push from a structure or node. */
export function restsOnStructure(w: CollisionWorld, x: number, y: number, z: number, r: number, h: number, probe: number): boolean {
  const low = y - probe - PAD;
  const top = y - probe + (h > 2 * r ? h : 2 * r) + PAD;
  const n = w.structs.query(x - r, z - r, x + r, z + r, found, low, top);
  for (let i = 0; i < n; i++) {
    if (capsuleBox(w.structs, found.refs[i]!, x, y - probe, z, r, h, 0) && push.y > 0.7 * push.depth) return true;
  }
  const nodes = w.nodes;
  if (nodes) {
    const m = nodes.query(x - r, z - r, x + r, z + r, found, low, top);
    for (let i = 0; i < m; i++) {
      if (capsuleBox(nodes, found.refs[i]!, x, y - probe, z, r, h, 0) && push.y > 0.7 * push.depth) return true;
    }
  }
  return false;
}
