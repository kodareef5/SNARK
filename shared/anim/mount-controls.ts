// Reach vehicle controls after solving the survivor's actual proportions. Bones keep their lengths; an unreachable
// control is approached as far as the arm can comfortably reach, never by stretching or moving the seated pelvis.
import { quatAxis, quatIdentity, quatMul, quatMulConj, quatRotate, type Numbers } from "../math/quat.ts";
import { TAU } from "../math/scalar.ts";
import type { Pose } from "./clip.ts";
import { B_FINGERS_L, B_FINGERS_R, B_HAND_L, B_HAND_R, B_LOWER_ARM_L, B_LOWER_ARM_R, B_PROP_L, B_PROP_R, B_THUMB_L, B_THUMB_R, B_UPPER_ARM_L, B_UPPER_ARM_R, HUMAN } from "./human.ts";
import { bend, square, toward, within } from "./ik.ts";
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
const q = new Float64Array(4), hand = new Float64Array(4), vector = new Float64Array(3), pole = new Float64Array(3);
const usable = new Uint8Array(2);
const UNIT_SCALE = new Float32Array(HUMAN.bones * 3).fill(1);

/**
 * `solved` must be solve(HUMAN, pose, solved, rest, scale). Updates both pose and solved; call before placing the
 * seated body in the vehicle's full frame. Helicopter hands wrap the fore/aft collective and upright cyclic;
 * helm hands grasp opposite upright sides of a wheel, with their palms facing inward and fingers forward.
 * Returns the greatest remaining grip distance, in metres, so unreachable content can be diagnosed explicitly.
 */
export function fitPilotControls(pose: Pose, solved: Solved, rest: Float32Array, scale: Float32Array | null, left: MountControl, right: MountControl, style: "helicopter" | "helm" | "handlebar" = "helicopter"): number {
  const scales = scale ?? UNIT_SCALE;
  for (let side = 0; side < 2; side++) {
    const [upper, lower, wrist, prop, , , sign] = ARMS[side]!;
    const control = side === 0 ? left : right, at = side * 3;
    // At a helm both palms face the wheel's centre and their fingers curl around its upright rim. Mirroring the
    // grasp (rather than reusing the collective pose) also keeps both wrists behind the wheel through steering.
    quatIdentity(hand, 0);
    if (style === "handlebar") {
      // Both palms rest on top of the transverse bar; fingers curl forward round its axis.
      quatAxis(hand, 0, 0, 1, 0, -sign * TAU / 4);
    } else if (style === "helm" || side === 1) {
      const turn = style === "helm" ? -sign * TAU / 4 : TAU / 4;
      quatAxis(hand, 0, 0, 1, 0, turn);
      quatAxis(q, 0, 0, 0, 1, turn);
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
    const reach = within(distance, Math.abs(a - b) + .002, (a + b) * .985);
    wrists[at] = solved.pos[upper * 3]! + dx * reach;
    wrists[at + 1] = solved.pos[upper * 3 + 1]! + dy * reach;
    wrists[at + 2] = solved.pos[upper * 3 + 2]! + dz * reach;
    // A fixed outward/downward pole prevents elbow flips as the control moves through neutral.
    let length = square(pole, 0, sign * .15, -1, -.1, dx, dy, dz);
    if (length < 1e-6) { pole[0] = -dz; pole[1] = 0; pole[2] = dx; length = Math.sqrt(dz * dz + dx * dx); }
    bend(elbows, at, solved.pos[upper * 3]!, solved.pos[upper * 3 + 1]!, solved.pos[upper * 3 + 2]!, dx, dy, dz, reach, a, b, pole[0]!, pole[1]!, pole[2]!, length);
    toward(q, 0, ux, uy, uz, elbows[at]! - solved.pos[upper * 3]!, elbows[at + 1]! - solved.pos[upper * 3 + 1]!, elbows[at + 2]! - solved.pos[upper * 3 + 2]!);
    quatMulConj(pose.rot, upper * 4, solved.rot, HUMAN.parent[upper]! * 4, q, 0);
  }
  solve(HUMAN, pose, solved, rest, scale);
  for (let side = 0; side < 2; side++) {
    if (!usable[side]) continue;
    const [upper, lower, wrist] = ARMS[side]!, at = side * 3;
    toward(q, 0, (rest[wrist * 3]! - rest[lower * 3]!) * scales[lower * 3 + 0]!, (rest[wrist * 3 + 1]! - rest[lower * 3 + 1]!) * scales[lower * 3 + 1]!, (rest[wrist * 3 + 2]! - rest[lower * 3 + 2]!) * scales[lower * 3 + 2]!, wrists[at]! - elbows[at]!, wrists[at + 1]! - elbows[at + 1]!, wrists[at + 2]! - elbows[at + 2]!);
    quatMulConj(pose.rot, lower * 4, solved.rot, upper * 4, q, 0);
  }
  solve(HUMAN, pose, solved, rest, scale);
  for (let side = 0; side < 2; side++) {
    if (!usable[side]) continue;
    const [, lower, wrist, , fingers, thumb, sign] = ARMS[side]!;
    quatMulConj(pose.rot, wrist * 4, solved.rot, lower * 4, hands, side * 4);
    quatAxis(pose.rot, fingers * 4, 0, 0, 1, -sign * 1.8);
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
