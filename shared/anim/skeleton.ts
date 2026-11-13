// Skeletons: bones, where they rest, and the capsules on them that can be hit.
//
// Every skeleton rests with all bone rotations at identity, so a bone's own
// axes at rest are the model's axes (+Y up, facing +Z). A pose turns bones
// relative to their parents; `solve` walks the tree once and gives each bone's
// rotation and joint position in model space.
//
// A hit shape is a capsule in its bone's space: a segment and a radius, which
// is what a limb, a head and a slice of a torso each nearly are. It turns with
// the bone. The same capsules serve the server (which hits them) and the
// mannequin mesh (which draws them), and they are fitted to the modelled
// bodies, so what is drawn and what is hit do not drift apart.

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
  /** Bones 0 .. zoneBones-1 carry a hit capsule. */
  readonly zoneBones: number;
  /** Zone id of each bone's capsule; 0 for none. */
  readonly zone: Uint8Array;
  /** The two ends of each bone's capsule in the bone's space, relative to its joint, and its radius. */
  readonly capA: Float32Array;
  readonly capB: Float32Array;
  readonly capR: Float32Array;
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
 * Where a ray first meets a capsule: the distance along the ray, 0 if it
 * starts inside, or -1 for a miss. The ray starts at (ox, oy, oz) and runs
 * along the unit direction (dx, dy, dz); the capsule has ends a and b and
 * radius r.
 */
export function rayCapsule(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const oax = ox - ax, oay = oy - ay, oaz = oz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  // Inside already? The nearest point of the segment is within the radius.
  let s = baba > 0 ? baoa / baba : 0;
  if (s < 0) s = 0;
  else if (s > 1) s = 1;
  const nx = oax - bax * s, ny = oay - bay * s, nz = oaz - baz * s;
  if (nx * nx + ny * ny + nz * nz <= r * r) return 0;
  // The round side: a cylinder about the segment, between its ends.
  const a = baba - bard * bard;
  if (a > 1e-12) {
    const b = baba * rdoa - baoa * bard;
    const c = baba * oaoa - baoa * baoa - r * r * baba;
    const h = b * b - a * c;
    if (h < 0) return -1;
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
    // Past an end: the ball at that end.
    const ex = y <= 0 ? oax : ox - bx, ey = y <= 0 ? oay : oy - by, ez = y <= 0 ? oaz : oz - bz;
    const eb = dx * ex + dy * ey + dz * ez;
    const eh = eb * eb - (ex * ex + ey * ey + ez * ez - r * r);
    if (eh < 0) return -1;
    const et = -eb - Math.sqrt(eh);
    return et >= 0 ? et : -1;
  }
  // Along the segment (or the capsule is a ball): the nearer of the two end balls.
  let best = -1;
  for (let end = 0; end < 2; end++) {
    const ex = end === 0 ? oax : ox - bx, ey = end === 0 ? oay : oy - by, ez = end === 0 ? oaz : oz - bz;
    const eb = dx * ex + dy * ey + dz * ez;
    const eh = eb * eb - (ex * ex + ey * ey + ez * ez - r * r);
    if (eh < 0) continue;
    const et = -eb - Math.sqrt(eh);
    if (et >= 0 && (best < 0 || et < best)) best = et;
  }
  return best;
}

/**
 * The first hit capsule a ray meets, in model space: origin (ox, oy, oz), unit
 * direction (dx, dy, dz), no farther than `maxT`. Returns the zone id, or 0
 * for a miss, and fills `zoneHit`. A ray starting inside a capsule hits it at 0.
 */
export function rayZones(skel: Skeleton, pose: Solved, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  let best = maxT;
  let zone = 0;
  let bone = -1;
  const A = skel.capA;
  const B = skel.capB;
  for (let b = 0; b < skel.zoneBones; b++) {
    if (skel.zone[b] === 0) continue;
    // Into the bone's space, where its capsule is fixed.
    quatUnrotate(pose.rot, b * 4, ox - pose.pos[b * 3]!, oy - pose.pos[b * 3 + 1]!, oz - pose.pos[b * 3 + 2]!, o, 0);
    quatUnrotate(pose.rot, b * 4, dx, dy, dz, d, 0);
    const t = rayCapsule(o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!, A[b * 3]!, A[b * 3 + 1]!, A[b * 3 + 2]!, B[b * 3]!, B[b * 3 + 1]!, B[b * 3 + 2]!, skel.capR[b]!);
    if (t >= 0 && t < best) {
      best = t;
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
