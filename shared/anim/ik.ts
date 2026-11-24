// Two-bone reach for every limb fit: the shortest turn between two directions, a reach held within bounds, a pole squared
// to the reach, and the triangle that places the middle joint. Only exactly rounded arithmetic is used, so the server and
// every client place the same joints. Each fit keeps its own margins and fallbacks; these pieces are what they share.

import { quatMul, quatMulConj, quatNormalize, type Numbers } from "../math/quat.ts";
import type { Pose } from "./clip.ts";
import type { Skeleton, Solved } from "./skeleton.ts";

/** Writes to `out` at `o` the shortest turn taking direction a to direction b. Neither may be zero; opposite ones turn about a fixed square axis. */
export function toward(out: Numbers, o: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const al = Math.sqrt(ax * ax + ay * ay + az * az), bl = Math.sqrt(bx * bx + by * by + bz * bz);
  ax /= al; ay /= al; az /= al; bx /= bl; by /= bl; bz /= bl;
  const dot = ax * bx + ay * by + az * bz;
  if (dot < -.999999) {
    const x = Math.abs(ax) < .9 ? 1 : 0, y = 1 - x;
    out[o] = -az * y; out[o + 1] = az * x; out[o + 2] = ax * y - ay * x; out[o + 3] = 0;
  } else { out[o] = ay * bz - az * by; out[o + 1] = az * bx - ax * bz; out[o + 2] = ax * by - ay * bx; out[o + 3] = 1 + dot; }
  quatNormalize(out, o);
}

/** The distance held between `near` and `far`, `near` winning where they cross. */
export function within(distance: number, near: number, far: number): number {
  return Math.max(near, Math.min(far, distance));
}

/** The reach of bones a and b whose middle joint is folded by an angle of this cosine: 1 is straight, -1 folded flat. */
export function foldReach(a: number, b: number, cosine: number): number {
  return Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * cosine));
}

/** Writes to `out` at `o` the part of pole p square to the unit direction d, and returns its length. */
export function square(out: Numbers, o: number, px: number, py: number, pz: number, dx: number, dy: number, dz: number): number {
  const along = px * dx + py * dy + pz * dz;
  px -= dx * along; py -= dy * along; pz -= dz * along;
  out[o] = px; out[o + 1] = py; out[o + 2] = pz;
  return Math.sqrt(px * px + py * py + pz * pz);
}

/**
 * Writes to `out` at `o` the middle joint of bones a and b reaching from root s along the unit direction d to an end
 * `reach` away. It bends toward pole p, square to d and `length` long.
 */
export function bend(out: Numbers, o: number, sx: number, sy: number, sz: number, dx: number, dy: number, dz: number, reach: number,
  a: number, b: number, px: number, py: number, pz: number, length: number): void {
  const forward = (a * a - b * b + reach * reach) / (2 * reach), side = Math.sqrt(Math.max(0, a * a - forward * forward));
  out[o] = sx + dx * forward + px / length * side;
  out[o + 1] = sy + dy * forward + py / length * side;
  out[o + 2] = sz + dz * forward + pz / length * side;
}

/** The cosine of the angle at the root of bones a and b reaching `reach`. */
export function rootCosine(a: number, b: number, reach: number): number {
  return (a * a + reach * reach - b * b) / (2 * a * reach);
}

const pole = new Float64Array(3);

/**
 * Reaches bones a then b from root s for goal g, the middle joint bent toward pole p. The reach stays `margin` short of
 * straight and of folded flat, and inside the fold range when one is given: `straightest` and `foldest` are the cosines of
 * the least and the most fold (1 straight, -1 flat). A pole along the reach gives way to the side axis, then to forward.
 * Writes the end reached to `out` at `o` and the middle joint after it. Returns how far the end falls short of the goal,
 * or -1, writing nothing, for a bone shorter than a millimetre or a goal on the root.
 */
export function twoBone(out: Numbers, o: number, sx: number, sy: number, sz: number, gx: number, gy: number, gz: number, a: number, b: number,
  px: number, py: number, pz: number, margin = .002, straightest = 1, foldest = -1): number {
  let dx = gx - sx, dy = gy - sy, dz = gz - sz;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(a > .001 && b > .001 && distance > 1e-6)) return -1;
  dx /= distance; dy /= distance; dz /= distance;
  const near = Math.max(Math.abs(a - b) + margin, foldReach(a, b, foldest)), far = Math.min(a + b - margin, foldReach(a, b, straightest));
  const reach = within(distance, near, far);
  out[o] = sx + dx * reach; out[o + 1] = sy + dy * reach; out[o + 2] = sz + dz * reach;
  let length = square(pole, 0, px, py, pz, dx, dy, dz);
  if (length < 1e-6) length = square(pole, 0, 1, 0, 0, dx, dy, dz);
  if (length < 1e-6) length = square(pole, 0, 0, 0, 1, dx, dy, dz);
  bend(out, o + 3, sx, sy, sz, dx, dy, dz, reach, a, b, pole[0]!, pole[1]!, pole[2]!, length);
  return Math.abs(distance - reach);
}

const turn = new Float64Array(4);

/**
 * Turns `bone` so the direction it points along, now `from` in model space, becomes `to`; its twist about that direction
 * is kept. `solved` must hold the bone's and its parent's model rotations. Solve again before turning a child.
 */
export function aimBone(skel: Skeleton, pose: Pose, solved: Solved, bone: number, fx: number, fy: number, fz: number, tx: number, ty: number, tz: number): void {
  toward(turn, 0, fx, fy, fz, tx, ty, tz);
  quatMul(turn, 0, turn, 0, solved.rot, bone * 4);
  quatMulConj(pose.rot, bone * 4, solved.rot, skel.parent[bone]! * 4, turn, 0);
}
