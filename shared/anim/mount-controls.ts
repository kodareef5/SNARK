// Reach vehicle controls after solving the survivor's actual proportions. Bones keep their lengths; an unreachable
// control is approached as far as the arm can comfortably reach, never by stretching or moving the seated pelvis.
import { quatAxis, quatIdentity, quatMul, quatMulConj, quatNormalize, quatRotate, type Numbers } from "../math/quat.ts";
import { TAU } from "../math/scalar.ts";
import type { Pose } from "./clip.ts";
import { B_FINGERS_L, B_FINGERS_R, B_HAND_L, B_HAND_R, B_LOWER_ARM_L, B_LOWER_ARM_R, B_PROP_L, B_PROP_R, B_THUMB_L, B_THUMB_R, B_UPPER_ARM_L, B_UPPER_ARM_R, HUMAN } from "./human.ts";
import { solve, type Solved } from "./skeleton.ts";

export interface MountControl {
  /** Grip point relative to the survivor's seated pelvis, in the vehicle's local frame. */
  readonly position: ArrayLike<number>;
  /** A control's own turn (for a moving cyclic), before the vehicle's attitude. */
  readonly rotation?: Numbers;
}

const ARMS = [
  [B_UPPER_ARM_L, B_LOWER_ARM_L, B_HAND_L, B_PROP_L, B_FINGERS_L, B_THUMB_L, 1],
  [B_UPPER_ARM_R, B_LOWER_ARM_R, B_HAND_R, B_PROP_R, B_FINGERS_R, B_THUMB_R, -1],
] as const;
const elbows = new Float64Array(6), wrists = new Float64Array(6), grips = new Float64Array(6), hands = new Float64Array(8);
const q = new Float64Array(4), hand = new Float64Array(4), vector = new Float64Array(3);
const usable = new Uint8Array(2);
const UNIT_SCALE = new Float32Array(HUMAN.bones * 3).fill(1);

/** The shortest rotation from one nonzero direction to another. */
function toward(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const al = Math.sqrt(ax * ax + ay * ay + az * az), bl = Math.sqrt(bx * bx + by * by + bz * bz);
  ax /= al; ay /= al; az /= al; bx /= bl; by /= bl; bz /= bl;
  const dot = ax * bx + ay * by + az * bz;
  if (dot < -.999999) {
    const x = Math.abs(ax) < .9 ? 1 : 0, y = 1 - x;
    q[0] = -az * y; q[1] = az * x; q[2] = ax * y - ay * x; q[3] = 0;
  } else { q[0] = ay * bz - az * by; q[1] = az * bx - ax * bz; q[2] = ax * by - ay * bx; q[3] = 1 + dot; }
  quatNormalize(q, 0);
}

/**
 * `solved` must be solve(HUMAN, pose, solved, rest, scale). Updates both pose and solved; call before placing the
 * seated body in the vehicle's full frame. The left hand wraps a fore/aft collective, the right an upright cyclic.
 * Returns the greatest remaining grip distance, in metres, so unreachable content can be diagnosed explicitly.
 */
export function fitPilotControls(pose: Pose, solved: Solved, rest: Float32Array, scale: Float32Array | null, left: MountControl, right: MountControl): number {
  const scales = scale ?? UNIT_SCALE;
  for (let side = 0; side < 2; side++) {
    const [upper, lower, wrist, prop, , , sign] = ARMS[side]!;
    const control = side === 0 ? left : right, at = side * 3;
    // The right palm faces the upright stick; its fingers curl around +Y. The left palm lies over the collective.
    quatIdentity(hand, 0);
    if (side === 1) {
      quatAxis(hand, 0, 0, 1, 0, TAU / 4);
      quatAxis(q, 0, 0, 0, 1, TAU / 4);
      quatMul(hand, 0, q, 0, hand, 0);
    }
    if (control.rotation) quatMul(hand, 0, control.rotation, 0, hand, 0);
    hands.set(hand, side * 4);
    quatRotate(hand, 0, (rest[prop * 3]! - rest[wrist * 3]!) * scales[wrist * 3 + 0]!, (rest[prop * 3 + 1]! - rest[wrist * 3 + 1]!) * scales[wrist * 3 + 1]!, (rest[prop * 3 + 2]! - rest[wrist * 3 + 2]!) * scales[wrist * 3 + 2]!, vector, 0);
    for (let axis = 0; axis < 3; axis++) {
      grips[at + axis] = solved.pos[axis]! + control.position[axis]!;
      wrists[at + axis] = grips[at + axis]! - vector[axis]!;
    }
    const ux = (rest[lower * 3]! - rest[upper * 3]!) * scales[upper * 3 + 0]!, uy = (rest[lower * 3 + 1]! - rest[upper * 3 + 1]!) * scales[upper * 3 + 1]!, uz = (rest[lower * 3 + 2]! - rest[upper * 3 + 2]!) * scales[upper * 3 + 2]!;
    const lx = (rest[wrist * 3]! - rest[lower * 3]!) * scales[lower * 3 + 0]!, ly = (rest[wrist * 3 + 1]! - rest[lower * 3 + 1]!) * scales[lower * 3 + 1]!, lz = (rest[wrist * 3 + 2]! - rest[lower * 3 + 2]!) * scales[lower * 3 + 2]!;
    const a = Math.sqrt(ux * ux + uy * uy + uz * uz), b = Math.sqrt(lx * lx + ly * ly + lz * lz);
    let dx = wrists[at]! - solved.pos[upper * 3]!, dy = wrists[at + 1]! - solved.pos[upper * 3 + 1]!, dz = wrists[at + 2]! - solved.pos[upper * 3 + 2]!;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    usable[side] = a > 1e-6 && b > 1e-6 && distance > 1e-6 ? 1 : 0;
    if (!usable[side]) continue;
    dx /= distance; dy /= distance; dz /= distance;
    const reach = Math.max(Math.abs(a - b) + .002, Math.min((a + b) * .985, distance));
    wrists[at] = solved.pos[upper * 3]! + dx * reach;
    wrists[at + 1] = solved.pos[upper * 3 + 1]! + dy * reach;
    wrists[at + 2] = solved.pos[upper * 3 + 2]! + dz * reach;
    // A fixed outward/downward pole prevents elbow flips as the control moves through neutral.
    const along = dx * sign * .15 - dy - dz * .1;
    let px = sign * .15 - dx * along, py = -1 - dy * along, pz = -.1 - dz * along;
    let length = Math.sqrt(px * px + py * py + pz * pz);
    if (length < 1e-6) { px = -dz; py = 0; pz = dx; length = Math.sqrt(px * px + pz * pz); }
    const forward = (a * a - b * b + reach * reach) / (2 * reach), bend = Math.sqrt(Math.max(0, a * a - forward * forward));
    elbows[at] = solved.pos[upper * 3]! + dx * forward + px / length * bend;
    elbows[at + 1] = solved.pos[upper * 3 + 1]! + dy * forward + py / length * bend;
    elbows[at + 2] = solved.pos[upper * 3 + 2]! + dz * forward + pz / length * bend;
    toward(ux, uy, uz, elbows[at]! - solved.pos[upper * 3]!, elbows[at + 1]! - solved.pos[upper * 3 + 1]!, elbows[at + 2]! - solved.pos[upper * 3 + 2]!);
    quatMulConj(pose.rot, upper * 4, solved.rot, HUMAN.parent[upper]! * 4, q, 0);
  }
  solve(HUMAN, pose, solved, rest, scale);
  for (let side = 0; side < 2; side++) {
    if (!usable[side]) continue;
    const [upper, lower, wrist] = ARMS[side]!, at = side * 3;
    toward((rest[wrist * 3]! - rest[lower * 3]!) * scales[lower * 3 + 0]!, (rest[wrist * 3 + 1]! - rest[lower * 3 + 1]!) * scales[lower * 3 + 1]!, (rest[wrist * 3 + 2]! - rest[lower * 3 + 2]!) * scales[lower * 3 + 2]!, wrists[at]! - elbows[at]!, wrists[at + 1]! - elbows[at + 1]!, wrists[at + 2]! - elbows[at + 2]!);
    quatMulConj(pose.rot, lower * 4, solved.rot, upper * 4, q, 0);
  }
  solve(HUMAN, pose, solved, rest, scale);
  for (let side = 0; side < 2; side++) {
    if (!usable[side]) continue;
    const [, lower, wrist, , fingers, thumb, sign] = ARMS[side]!;
    quatMulConj(pose.rot, wrist * 4, solved.rot, lower * 4, hands, side * 4);
    quatAxis(pose.rot, fingers * 4, 0, 0, 1, -sign * 1.05);
    quatAxis(pose.rot, thumb * 4, 0, 0, 1, -sign * .35);
  }
  solve(HUMAN, pose, solved, rest, scale);
  let residual = 0;
  for (let side = 0; side < 2; side++) {
    const prop = ARMS[side]![3], at = side * 3;
    const dx = solved.pos[prop * 3]! - grips[at]!, dy = solved.pos[prop * 3 + 1]! - grips[at + 1]!, dz = solved.pos[prop * 3 + 2]! - grips[at + 2]!;
    residual = Math.max(residual, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  return residual;
}
