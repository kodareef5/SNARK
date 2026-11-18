// Every skeleton rests with all bone rotations at identity, so a bone's rest axes are the model's (+Y up, facing +Z).
// Physical capsules and optional skin-fitted weapon contacts are carried in bone space.

import { quatMul, quatRotate, quatUnrotate } from "../math/quat.ts";
import type { Pose } from "./clip.ts";
import { rayHulls, type HitSurfaces } from "./hit-hulls.ts";

export interface Skeleton {
  readonly id: string;
  readonly bones: number;
  readonly names: readonly string[];
  /** Parent of each bone, -1 for the root. A parent always comes before its children. */
  readonly parent: Int8Array;
  /** Rest joint position of each bone in model space, as x, y, z. */
  readonly rest: Float32Array;
  /** Bones 0 .. zoneBones-1 carry a hit capsule. */
  readonly zoneBones: number;
  readonly hitSurfaces?: HitSurfaces;
  /** Zone id of each bone's capsule, or 0 for none. */
  readonly zone: Uint8Array;
  /** The two ends of each bone's capsule in the bone's space, relative to its joint, and its radius. */
  readonly capA: Float32Array;
  readonly capB: Float32Array;
  readonly capR: Float32Array;
}

/** Rotation and joint position of every bone in model space. */
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
 * `rest` is the skeleton's own rest joints or a rig's (other proportions, same bones). `scale`, when given, stretches
 * each bone along its own axes (x, y, z per bone), which moves its children. jointOffsets add translation in
 * the parent frame before scaling, for mechanisms such as sliding doors.
 */
export function solve(skel: Skeleton, pose: Pose, out: Solved, rest: Float32Array = skel.rest, scale: Float32Array | null = null, jointOffsets?: Float32Array): void {
  const rot = out.rot;
  const pos = out.pos;
  for (let b = 0; b < skel.bones; b++) {
    const p = skel.parent[b]!;
    if (p < 0) {
      for (let k = 0; k < 4; k++) rot[b * 4 + k] = pose.rot[b * 4 + k]!;
      for (let k = 0; k < 3; k++) pos[b * 3 + k] = rest[b * 3 + k]! + pose.root[k]! + (jointOffsets?.[b * 3 + k] ?? 0);
      continue;
    }
    quatMul(rot, b * 4, rot, p * 4, pose.rot, b * 4);
    let ox = rest[b * 3]! - rest[p * 3]!;
    let oy = rest[b * 3 + 1]! - rest[p * 3 + 1]!;
    let oz = rest[b * 3 + 2]! - rest[p * 3 + 2]!;
    if (jointOffsets) {
      ox += jointOffsets[b * 3]!;
      oy += jointOffsets[b * 3 + 1]!;
      oz += jointOffsets[b * 3 + 2]!;
    }
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

/** Filled by `rayZones`: the zone, its bone, and the distance along the ray. */
export const zoneHit = { zone: 0, bone: -1, t: 0 };

const o = new Float64Array(3);
const d = new Float64Array(3);

/**
 * Returns the distance along the ray to a capsule, 0 if the ray starts inside, or -1 for a miss. The ray starts at
 * (ox, oy, oz) and runs along the unit direction (dx, dy, dz). The capsule has ends a and b and radius r.
 */
export function rayCapsule(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const oax = ox - ax, oay = oy - ay, oaz = oz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  // The ray starts inside if the nearest point of the segment is within the radius.
  let s = baba > 0 ? baoa / baba : 0;
  if (s < 0) s = 0;
  else if (s > 1) s = 1;
  const nx = oax - bax * s, ny = oay - bay * s, nz = oaz - baz * s;
  if (nx * nx + ny * ny + nz * nz <= r * r) return 0;
  // Test the cylinder about the segment, between its ends.
  const a = baba - bard * bard;
  if (a > 1e-12) {
    const b = baba * rdoa - baoa * bard;
    const c = baba * oaoa - baoa * baoa - r * r * baba;
    const h = b * b - a * c;
    if (h < 0) return -1;
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t >= 0 ? t : -1;
    // Past an end, test the ball at that end.
    const ex = y <= 0 ? oax : ox - bx, ey = y <= 0 ? oay : oy - by, ez = y <= 0 ? oaz : oz - bz;
    const eb = dx * ex + dy * ey + dz * ez;
    const eh = eb * eb - (ex * ex + ey * ey + ez * ez - r * r);
    if (eh < 0) return -1;
    const et = -eb - Math.sqrt(eh);
    return et >= 0 ? et : -1;
  }
  // The ray runs along the segment, or the capsule is a ball. Take the nearer of the two end balls.
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
 * Tests a model-space ray from (ox, oy, oz) along the unit direction (dx, dy, dz), no farther than `maxT`. Returns the
 * zone id of the first contact, or 0 for a miss, and fills `zoneHit`. A ray starting inside a volume hits it at 0. Camera clearance and physics diagnostics can request the original capsules.
 */
export function rayZones(skel: Skeleton, pose: Solved, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, padding = 0, shape: "skin" | "capsules" = "skin"): number {
  let best = maxT;
  let zone = 0;
  let bone = -1;
  const A = skel.capA;
  const B = skel.capB;
  const surfaces = shape === "skin" ? skel.hitSurfaces : undefined;
  for (let b = 0; b < skel.zoneBones; b++) {
    const hull = surfaces?.bone[b];
    if (!hull && (!skel.zone[b] || surfaces?.replace[b])) continue;
    // Move the ray into the bone's space, where its capsule is fixed.
    quatUnrotate(pose.rot, b * 4, ox - pose.pos[b * 3]!, oy - pose.pos[b * 3 + 1]!, oz - pose.pos[b * 3 + 2]!, o, 0);
    quatUnrotate(pose.rot, b * 4, dx, dy, dz, d, 0);
    const t = hull ? rayHulls(hull, o, d, best, padding) : rayCapsule(o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!, A[b * 3]!, A[b * 3 + 1]!, A[b * 3 + 2]!, B[b * 3]!, B[b * 3 + 1]!, B[b * 3 + 2]!, skel.capR[b]! + padding);
    if (t >= 0 && (t < best || (t === best && zone === 0))) {
      best = t;
      zone = hull?.zone ?? skel.zone[b]!;
      bone = b;
    }
  }
  zoneHit.zone = zone;
  zoneHit.bone = bone;
  zoneHit.t = best;
  return zone;
}

export function boneToModel(pose: Solved, bone: number, x: number, y: number, z: number, out: Float32Array | Float64Array | number[]): void {
  quatRotate(pose.rot, bone * 4, x, y, z, out, 0);
  out[0]! += pose.pos[bone * 3]!;
  out[1]! += pose.pos[bone * 3 + 1]!;
  out[2]! += pose.pos[bone * 3 + 2]!;
}
