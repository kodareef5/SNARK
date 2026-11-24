// Saddle contacts after the actual survivor proportions have been solved. This adjusts rotations only: the seated
// pelvis and limb lengths are fixed, so an impossible saddle produces a measurable residual rather than stretched limbs.
import { quatAxis, quatIdentity, quatMul, quatMulConj, quatRotate } from "../math/quat.ts";
import { PI, detCos, detSin } from "../math/scalar.ts";
import type { Pose } from "./clip.ts";
import { B_FINGERS_L, B_FINGERS_R, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R, B_PROP_L, B_PROP_R, B_THUMB_L, B_THUMB_R, B_UPPER_ARM_L, B_UPPER_ARM_R, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN } from "./human.ts";
import { bend, square, toward, within } from "./ik.ts";
import { GRIP_POSE_FLOATS } from "./rider-grips.ts";
import { solve, type Solved } from "./skeleton.ts";
import { B_TOE_L, B_TOE_R, B_FINGERTIPS_L, B_FINGERTIPS_R } from "./human.ts";

export const RIDER_TARGET_FLOATS = 31;
export const RIDER_HANDS = 1;
export const RIDER_FEET = 2;
export const RIDER_KNEES = 4;
export const RIDER_SOLES = 8;
export const RIDER_GRIPS = 16;
export const RIDER_HAND_L = 1;
export const RIDER_HAND_R = 4;
export const RIDER_FOOT_L = 7;
export const RIDER_FOOT_R = 10;
export const RIDER_KNEE_L = 13;
export const RIDER_KNEE_R = 16;
export const RIDER_SOLE_L = 19;
export const RIDER_SOLE_R = 22;
export const RIDER_SOLE_HALF = 25;
export const RIDER_GRIP_RADIUS = 27;
export const RIDER_GRIP_LOW = 28;
export const RIDER_GRIP_HIGH = 29;
export const RIDER_FOREARM_ALIGNMENT = 30;

const LIMBS = [
  [B_UPPER_ARM_L, B_LOWER_ARM_L, B_HAND_L, B_PROP_L, 1],
  [B_UPPER_ARM_R, B_LOWER_ARM_R, B_HAND_R, B_PROP_R, -1],
  [B_UPPER_LEG_L, B_LOWER_LEG_L, B_FOOT_L, B_FOOT_L, 1],
  [B_UPPER_LEG_R, B_LOWER_LEG_R, B_FOOT_R, B_FOOT_R, -1],
] as const;
const q = new Float64Array(4), v = new Float64Array(3), twist = new Float64Array(4), pole = new Float64Array(3);
const ends = new Float64Array(12), bends = new Float64Array(12), rotations = new Float64Array(16);
const usable = new Uint8Array(4), selected = new Uint8Array(4);
const goals = new Float64Array(12), supportFault = new Uint8Array(4);
const UNIT_SCALE = new Float32Array(HUMAN.bones * 3).fill(1);
function length3(x: number, y: number, z: number): number { return Math.sqrt(x * x + y * y + z * z); }

/**
 * `solved` must already be solve(HUMAN, pose, solved, rest, scale). Targets are in that HUMAN pose's local frame,
 * before its seat/world transform: index 0 is the RIDER_ bit mask; 1..6 B_PROP grips, 7..12 B_FOOT ankles,
 * 13..18 optional knee poles; 19..24 optional sole platform centres, each left then right; 25..26 platform half width/depth; 27..29 upright grip radius and signed lower/upper span; 30 optional maximum forearm alignment in degrees.
 * A pole chooses the bend direction, not a forced joint position. Optional native `soles` offsets correct ankle Y only
 * when the actual lowest vertex lands inside its finite platform. Optional `grips` holds the cached native left/right marker corrections and finger/thumb angles. No contact moves the pelvis. Missing calibration
 * retains the authored ankle target; an invalid footprint also retains it but reports Infinity for that foot.
 * `hands=false` preserves the entire passenger/weapon upper pose. Missing target groups preserve their limbs too.
 * Returns the greatest contact error in metres; optional residuals[0..3] gives hand L/R then foot L/R (0 if omitted).
 * Invalid coordinates/zero-length chains leave that limb unchanged and report Infinity. Scratch is reused, no allocation.
 */
export function fitRiderControls(pose: Pose, solved: Solved, rest: Float32Array, scale: Float32Array | null, targets: Float64Array, hands = true, residuals?: Float32Array | Float64Array, soles: Float64Array | null = null, grips: Float64Array | null = null): number {
  const scales = scale ?? UNIT_SCALE, mask = targets[0]!;
  const alignment = targets[RIDER_FOREARM_ALIGNMENT] ?? 0;
  const alignmentValid = Number.isFinite(alignment) && alignment >= 0 && alignment <= 90;
  const half = alignmentValid ? alignment * PI / 360 : 0, twistCos = detCos(half), twistSin = detSin(half);
  if(grips){
    if(grips.length!==GRIP_POSE_FLOATS)grips=null;
    else for(let i=0;i<GRIP_POSE_FLOATS;i++)if(!Number.isFinite(grips[i])){grips=null;break;}
  }
  if ((mask & RIDER_FEET) === 0 && (!hands || (mask & RIDER_HANDS) === 0)) {
    if (residuals) residuals.fill(0, 0, 4);
    return 0;
  }
  for (let limb = 0; limb < 4; limb++) {
    const arm = limb < 2, at = limb * 3, rot = limb * 4;
    selected[limb] = arm ? hands && (mask & RIDER_HANDS) !== 0 ? 1 : 0 : (mask & RIDER_FEET) !== 0 ? 1 : 0;
    usable[limb] = 0;
    supportFault[limb] = 0;
    if (residuals) residuals[limb] = 0;
    if (!selected[limb]) continue;
    const chain = LIMBS[limb]!, upper = chain[0], lower = chain[1], end = chain[2], contact = chain[3], sign = chain[4];
    let gx = targets[1 + at]!, gz = targets[3 + at]!;
    let gy = targets[2 + at]!;
    if (arm && (mask & RIDER_GRIPS) !== 0) {
      if (grips) { gx += sign * grips[limb*6]!; gz += grips[limb*6+1]!; }
      else supportFault[limb] = 1;
      if (!alignmentValid) supportFault[limb] = 1;
    }
    if (!arm && soles && (mask & RIDER_SOLES) !== 0) {
      const side = limb - 2, witness = side * 3, support = RIDER_SOLE_L + witness;
      const width = targets[RIDER_SOLE_HALF]!, depth = targets[RIDER_SOLE_HALF + 1]!;
      if (Number.isFinite(soles[witness + 1]) && Number.isFinite(targets[support + 1]) && width > 0 && depth > 0 &&
        Math.abs(gx + soles[witness]! - targets[support]!) <= width && Math.abs(gz + soles[witness + 2]! - targets[support + 2]!) <= depth) gy = targets[support + 1]! - soles[witness + 1]!;
      else supportFault[limb] = 1; // Keep ordinary ankle fitting; an absent finite platform cannot claim contact.
    }
    goals[at] = gx; goals[at + 1] = gy; goals[at + 2] = gz;
    if (!Number.isFinite(gx) || !Number.isFinite(gy) || !Number.isFinite(gz)) continue;
    quatIdentity(rotations, rot);
    if (arm) {
      // Palms face inward and fingers point forward around upright saddle grips.
      quatAxis(rotations, rot, 0, 1, 0, -sign * Math.PI / 2);
      quatAxis(q, 0, 0, 0, 1, -sign * Math.PI / 2);
      quatMul(rotations, rot, q, 0, rotations, rot);
      quatRotate(rotations, rot, (rest[contact * 3]! - rest[end * 3]!) * scales[end * 3]!, (rest[contact * 3 + 1]! - rest[end * 3 + 1]!) * scales[end * 3 + 1]!, (rest[contact * 3 + 2]! - rest[end * 3 + 2]!) * scales[end * 3 + 2]!, v, 0);
    } else v.fill(0);
    const sx = solved.pos[upper * 3]!, sy = solved.pos[upper * 3 + 1]!, sz = solved.pos[upper * 3 + 2]!;
    const ux = (rest[lower * 3]! - rest[upper * 3]!) * scales[upper * 3]!, uy = (rest[lower * 3 + 1]! - rest[upper * 3 + 1]!) * scales[upper * 3 + 1]!, uz = (rest[lower * 3 + 2]! - rest[upper * 3 + 2]!) * scales[upper * 3 + 2]!;
    const lx = (rest[end * 3]! - rest[lower * 3]!) * scales[lower * 3]!, ly = (rest[end * 3 + 1]! - rest[lower * 3 + 1]!) * scales[lower * 3 + 1]!, lz = (rest[end * 3 + 2]! - rest[lower * 3 + 2]!) * scales[lower * 3 + 2]!;
    const a = length3(ux, uy, uz), b = length3(lx, ly, lz);
    if (!(a > 1e-6) || !(b > 1e-6) || !Number.isFinite(a + b)) continue;
    let dx = gx - v[0]! - sx, dy = gy - v[1]! - sy, dz = gz - v[2]! - sz;
    const distance = length3(dx, dy, dz);
    if (distance > 1e-8) { dx /= distance; dy /= distance; dz /= distance; }
    else { dx = 0; dy = arm ? 0 : -1; dz = arm ? 1 : 0; }
    // Stay just inside full extension/folding to avoid a singular knee/elbow, without changing either segment length.
    const margin = Math.min(.002, Math.min(a, b) * .01);
    const reach = within(distance, Math.abs(a - b) + margin, a + b - margin);
    ends[at] = sx + dx * reach; ends[at + 1] = sy + dy * reach; ends[at + 2] = sz + dz * reach;
    let px = sign * (arm ? .45 : 1), py = arm ? -1 : -.15, pz = arm ? .1 : .6;
    if (!arm && (mask & RIDER_KNEES) !== 0) {
      const pole = RIDER_KNEE_L + (limb - 2) * 3;
      if (Number.isFinite(targets[pole]) && Number.isFinite(targets[pole + 1]) && Number.isFinite(targets[pole + 2])) {
        px = targets[pole]! - sx; py = targets[pole + 1]! - sy; pz = targets[pole + 2]! - sz;
      }
    }
    let length = square(pole, 0, px, py, pz, dx, dy, dz);
    // A pole directly on the reach axis is ambiguous. Choose the outward axis, or forward if parallel to it.
    if (length < 1e-8) length = square(pole, 0, Math.abs(dx) < .9 ? sign : 0, 0, Math.abs(dx) < .9 ? 0 : 1, dx, dy, dz);
    bend(bends, at, sx, sy, sz, dx, dy, dz, reach, a, b, pole[0]!, pole[1]!, pole[2]!, length);
    toward(q, 0, ux, uy, uz, bends[at]! - sx, bends[at + 1]! - sy, bends[at + 2]! - sz);
    quatMulConj(pose.rot, upper * 4, solved.rot, HUMAN.parent[upper]! * 4, q, 0);
    usable[limb] = 1;
  }
  solve(HUMAN, pose, solved, rest, scale);
  for (let limb = 0; limb < 4; limb++) {
    if (!usable[limb]) continue;
    const chain = LIMBS[limb]!, upper = chain[0], lower = chain[1], end = chain[2], at = limb * 3;
    toward(q, 0, (rest[end * 3]! - rest[lower * 3]!) * scales[lower * 3]!, (rest[end * 3 + 1]! - rest[lower * 3 + 1]!) * scales[lower * 3 + 1]!, (rest[end * 3 + 2]! - rest[lower * 3 + 2]!) * scales[lower * 3 + 2]!, ends[at]! - bends[at]!, ends[at + 1]! - bends[at + 1]!, ends[at + 2]! - bends[at + 2]!);
    if (limb < 2 && (mask & RIDER_GRIPS) !== 0 && grips && alignmentValid && alignment > 0) {
      // The shortest swing leaves an arbitrary forearm roll. Transfer the longitudinal part of the desired wrist
      // rotation onto the forearm, bounded by the authored allowance. The elbow/wrist positions cannot move:
      // this axis is exactly the scaled lower-arm→hand offset. The final hand rotation is restored below.
      let ax = (rest[end * 3]! - rest[lower * 3]!) * scales[lower * 3]!;
      let ay = (rest[end * 3 + 1]! - rest[lower * 3 + 1]!) * scales[lower * 3 + 1]!;
      let az = (rest[end * 3 + 2]! - rest[lower * 3 + 2]!) * scales[lower * 3 + 2]!;
      const length = length3(ax, ay, az); ax /= length; ay /= length; az /= length;
      quatMulConj(twist, 0, q, 0, rotations, limb * 4);
      let along = twist[0]! * ax + twist[1]! * ay + twist[2]! * az, w = twist[3]!;
      if (w < 0) { along = -along; w = -w; }
      const norm = Math.sqrt(along * along + w * w);
      if (norm > 1e-8) {
        along /= norm; w /= norm;
        if (w < twistCos) { along = (along < 0 ? -1 : 1) * twistSin; w = twistCos; }
        twist[0] = ax * along; twist[1] = ay * along; twist[2] = az * along; twist[3] = w;
        quatMul(q, 0, q, 0, twist, 0);
      }
    }
    quatMulConj(pose.rot, lower * 4, solved.rot, upper * 4, q, 0);
  }
  solve(HUMAN, pose, solved, rest, scale);
  for (let limb = 0; limb < 4; limb++) {
    if (!usable[limb]) continue;
    const chain = LIMBS[limb]!, lower = chain[1], end = chain[2], sign = chain[4];
    quatMulConj(pose.rot, end * 4, solved.rot, lower * 4, rotations, limb * 4);
    if (limb < 2) {
      const calibrated = (mask & RIDER_GRIPS) !== 0 && grips !== null;
      quatAxis(pose.rot, (limb === 0 ? B_FINGERS_L : B_FINGERS_R) * 4, 0, 0, 1, -sign * (calibrated ? grips![limb*6+2]! : 1.8));
      const thumb = (limb === 0 ? B_THUMB_L : B_THUMB_R) * 4;
      quatAxis(pose.rot, thumb, 0, 0, 1, -sign * (calibrated ? grips![limb*6+4]! : .35));
      if (calibrated) {
        quatAxis(q, 0, 0, 1, 0, sign * grips![limb*6+5]!); quatMul(pose.rot, thumb, pose.rot, thumb, q, 0);
        quatAxis(pose.rot, (limb === 0 ? B_FINGERTIPS_L : B_FINGERTIPS_R) * 4, 0, 0, 1, -sign * grips![limb*6+3]!);
      } else quatIdentity(pose.rot, (limb === 0 ? B_FINGERTIPS_L : B_FINGERTIPS_R) * 4);
    } else if (soles && (mask & RIDER_SOLES) !== 0 && !supportFault[limb]) quatIdentity(pose.rot, (limb === 2 ? B_TOE_L : B_TOE_R) * 4);
  }
  solve(HUMAN, pose, solved, rest, scale);
  let worst = 0;
  for (let limb = 0; limb < 4; limb++) {
    if (!selected[limb]) continue;
    const contact = LIMBS[limb]![3], at = 1 + limb * 3;
    const error = usable[limb] && !supportFault[limb] ? length3(solved.pos[contact * 3]! - goals[at - 1]!, solved.pos[contact * 3 + 1]! - goals[at]!, solved.pos[contact * 3 + 2]! - goals[at + 1]!) : Infinity;
    if (residuals) residuals[limb] = error;
    worst = Math.max(worst, error);
  }
  return worst;
}
