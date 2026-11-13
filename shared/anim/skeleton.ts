// Skeletons: bones, where they rest, and the boxes on them that can be hit.
//
// Every skeleton rests with all bone rotations at identity, so a bone's own
// axes at rest are the model's axes (+Y up, facing +Z). A pose turns bones
// relative to their parents; `solve` walks the tree once and gives each bone's
// rotation and joint position in model space.
//
// A hit box is an axis-aligned box in its bone's space: it turns with the bone.
// The same boxes serve the server (which hits them) and the mannequin mesh
// (which draws them), so what is drawn and what is hit cannot drift apart.

import { quatMul, quatRotate, quatUnrotate } from "../math/quat.ts";
import type { Pose } from "./clip.ts";

export interface Skeleton {
  readonly id: string;
  readonly bones: number;
  readonly names: readonly string[];
  /** Parent of each bone, -1 for the root. A parent always comes before its children. */
  readonly parent: Int8Array;
  /** Joint position of each bone at rest, model space: x, y, z each. */
  readonly rest: Float32Array;
  /** Bones 0 .. zoneBones-1 carry a hit box. */
  readonly zoneBones: number;
  /** Zone id of each bone's box; 0 for none. */
  readonly zone: Uint8Array;
  /** Box centre and half extents in the bone's space, relative to its joint. */
  readonly boxCenter: Float32Array;
  readonly boxHalf: Float32Array;
}

/** A solved pose: rotation and joint position of every bone in model space. */
export class Solved {
  readonly rot: Float32Array;
  readonly pos: Float32Array;

  constructor(bones: number) {
    this.rot = new Float32Array(bones * 4);
    this.pos = new Float32Array(bones * 3);
  }
}

const v = new Float64Array(3);

/**
 * Walk the tree: model-space rotation and joint position of every bone.
 * `rest` is where the joints rest, the skeleton's own or a rig's (a body of
 * other proportions with the same bones). `scale`, when given, stretches each
 * bone along its own axes (x, y, z per bone), which moves its children.
 */
export function solve(skel: Skeleton, pose: Pose, out: Solved, rest: Float32Array = skel.rest, scale: Float32Array | null = null): void {
  const rot = out.rot;
  const pos = out.pos;
  for (let b = 0; b < skel.bones; b++) {
    const p = skel.parent[b]!;
    if (p < 0) {
      for (let k = 0; k < 4; k++) rot[b * 4 + k] = pose.rot[b * 4 + k]!;
      for (let k = 0; k < 3; k++) pos[b * 3 + k] = rest[b * 3 + k]! + pose.root[k]!;
      continue;
    }
    quatMul(rot, b * 4, rot, p * 4, pose.rot, b * 4);
    let ox = rest[b * 3]! - rest[p * 3]!;
    let oy = rest[b * 3 + 1]! - rest[p * 3 + 1]!;
    let oz = rest[b * 3 + 2]! - rest[p * 3 + 2]!;
    if (scale) {
      ox *= scale[p * 3]!;
      oy *= scale[p * 3 + 1]!;
      oz *= scale[p * 3 + 2]!;
    }
    quatRotate(rot, p * 4, ox, oy, oz, v, 0);
    pos[b * 3] = pos[p * 3]! + v[0]!;
    pos[b * 3 + 1] = pos[p * 3 + 1]! + v[1]!;
    pos[b * 3 + 2] = pos[p * 3 + 2]! + v[2]!;
  }
}

/** What `rayZones` found: the zone, its bone, and how far along the ray. */
export const zoneHit = { zone: 0, bone: -1, t: 0 };

const o = new Float64Array(3);
const d = new Float64Array(3);

/**
 * The first hit box a ray meets, in model space: origin (ox, oy, oz), unit
 * direction (dx, dy, dz), no farther than `maxT`. Returns the zone id, or 0
 * for a miss, and fills `zoneHit`. A ray starting inside a box hits it at 0.
 */
export function rayZones(skel: Skeleton, pose: Solved, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  let best = maxT;
  let zone = 0;
  let bone = -1;
  const center = skel.boxCenter;
  const half = skel.boxHalf;
  for (let b = 0; b < skel.zoneBones; b++) {
    if (skel.zone[b] === 0) continue;
    // Into the bone's space: the box is axis-aligned there.
    quatUnrotate(pose.rot, b * 4, ox - pose.pos[b * 3]!, oy - pose.pos[b * 3 + 1]!, oz - pose.pos[b * 3 + 2]!, o, 0);
    quatUnrotate(pose.rot, b * 4, dx, dy, dz, d, 0);
    let t0 = 0;
    let t1 = best;
    for (let a = 0; a < 3 && t0 <= t1; a++) {
      const lo = center[b * 3 + a]! - half[b * 3 + a]! - o[a]!;
      const hi = center[b * 3 + a]! + half[b * 3 + a]! - o[a]!;
      const da = d[a]!;
      if (da === 0) {
        if (lo > 0 || hi < 0) t0 = Infinity;
        continue;
      }
      const ta = lo / da;
      const tb = hi / da;
      const near = ta < tb ? ta : tb;
      const far = ta < tb ? tb : ta;
      if (near > t0) t0 = near;
      if (far < t1) t1 = far;
    }
    if (t0 <= t1 && t0 < best) {
      best = t0;
      zone = skel.zone[b]!;
      bone = b;
    }
  }
  zoneHit.zone = zone;
  zoneHit.bone = bone;
  zoneHit.t = best;
  return zone;
}

/** Model-space position of a point given in a bone's space. */
export function boneToModel(pose: Solved, bone: number, x: number, y: number, z: number, out: Float32Array | Float64Array | number[]): void {
  quatRotate(pose.rot, bone * 4, x, y, z, out, 0);
  out[0]! += pose.pos[bone * 3]!;
  out[1]! += pose.pos[bone * 3 + 1]!;
  out[2]! += pose.pos[bone * 3 + 2]!;
}
