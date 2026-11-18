import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { Pose } from "../../shared/anim/clip.ts";
import { B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R, B_LOWER_LEG_L, B_LOWER_LEG_R, B_PROP_L, B_PROP_R, B_UPPER_ARM_L, B_UPPER_ARM_R, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { defaultLook, REGION_COUNT, lookScales, setRegion } from "../../shared/anim/look.ts";
import { createMountMotion, mountPose } from "../../shared/anim/mount.ts";
import { fitRiderControls, RIDER_FEET, RIDER_HANDS, RIDER_KNEES, RIDER_TARGET_FLOATS } from "../../shared/anim/rider-controls.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { quatAxis } from "../../shared/math/quat.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { fromArt, test } from "../fixtures/needs-art.ts";

const pack = fromArt(() => parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk", import.meta.url)))));
const profile = createMountMotion();
const pairs = [[B_UPPER_ARM_L, B_LOWER_ARM_L], [B_LOWER_ARM_L, B_HAND_L], [B_UPPER_ARM_R, B_LOWER_ARM_R], [B_LOWER_ARM_R, B_HAND_R], [B_UPPER_LEG_L, B_LOWER_LEG_L], [B_LOWER_LEG_L, B_FOOT_L], [B_UPPER_LEG_R, B_LOWER_LEG_R], [B_LOWER_LEG_R, B_FOOT_R]] as const;
const contacts = [B_PROP_L, B_PROP_R, B_FOOT_L, B_FOOT_R];
function distance(pos: Float32Array, a: number, b: number): number { return Math.hypot(pos[a * 3]! - pos[b * 3]!, pos[a * 3 + 1]! - pos[b * 3 + 1]!, pos[a * 3 + 2]! - pos[b * 3 + 2]!); }
function looks(): number[][] {
  const all = [-1, 0, 1].map(value => new Array<number>(REGION_COUNT).fill(value));
  for (let region = 0; region < REGION_COUNT; region++) for (const value of [-1, 1]) all.push(Array.from({ length: REGION_COUNT }, (_, r) => r === region ? value : -value));
  // A single opposite slider misses coupled short arms/small hands/tall torsos. Cover every corner of the
  // independent reach/height controls on both the narrow and wide body extremes.
  for (const width of [-1, 1]) for (let corner = 0; corner < 16; corner++) {
    const values = new Array<number>(REGION_COUNT).fill(width);
    [8, 11, 12, 19].forEach((region, bit) => values[region] = (corner & (1 << bit)) === 0 ? -1 : 1);
    all.push(values);
  }
  return all;
}
function fixture(rest: Float32Array, proportions = new Array<number>(REGION_COUNT).fill(0)) {
  const look = defaultLook(), scale = new Float32Array(HUMAN_BONES * 3), pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES);
  proportions.forEach((value, region) => setRegion(look, region, value)); lookScales(look, scale);
  mountPose(profile, { role: "ride", tick: 0, startTick: 0, durationTicks: 1 }, pose);
  solve(HUMAN, pose, solved, rest, scale);
  return { pose, solved, scale };
}
/** Species leads' source measurements are seat-relative; the rider pose origin is .55 m below that seat. */
function targets(grip: readonly number[], ankle: readonly number[], knee: readonly number[]): Float64Array {
  const out = new Float64Array(RIDER_TARGET_FLOATS); out[0] = RIDER_HANDS | RIDER_FEET | RIDER_KNEES;
  for (const [start, point] of [[1, grip], [7, ankle], [13, knee]] as const) for (let side = 0; side < 2; side++) {
    const at = start + side * 3; out[at] = point[0]! * (side === 0 ? 1 : -1); out[at + 1] = point[1]! + .55; out[at + 2] = point[2]!;
  }
  return out;
}
const trike = targets([.19, .31, .27], [.42, -.40, .38], [.48, -.08, .27]);
const stego = targets([.17, .06, .3434], [.27, -.49, .30], [.36, -.1, .36]);
const stegoFitted = targets([.17, .31, .27], [.27, -.49, .30], [.36, -.1, .36]);

test("native male and female riders fit feasible saddle contacts across mixed extreme proportions without moving hips or stretching", () => {
  let worst = 0;
  for (const body of pack.header.rigs) {
    const rest = Float32Array.from(body.rest);
    for (const proportions of looks()) for (const points of [trike, stegoFitted]) {
      const f = fixture(rest, proportions), pelvis = [...f.solved.pos.subarray(0, 3)], root = [...f.pose.root];
      const lengths = pairs.map(([a, b]) => distance(f.solved.pos, a, b));
      worst = Math.max(worst, fitRiderControls(f.pose, f.solved, rest, f.scale, points));
      expect([...f.pose.root]).toEqual(root); expect([...f.solved.pos.subarray(0, 3)]).toEqual(pelvis);
      pairs.forEach(([a, b], i) => expect(distance(f.solved.pos, a, b)).toBeCloseTo(lengths[i]!, 5));
      for (let limb = 0; limb < 4; limb++) for (let axis = 0; axis < 3; axis++) expect(f.solved.pos[contacts[limb]! * 3 + axis]).toBeCloseTo(points[1 + limb * 3 + axis]!, 4);
      for (const [upper, knee, sign] of [[B_UPPER_LEG_L, B_LOWER_LEG_L, 1], [B_UPPER_LEG_R, B_LOWER_LEG_R, -1]] as const) expect((f.solved.pos[knee * 3]! - f.solved.pos[upper * 3]!) * sign).toBeGreaterThan(.1);
    }
  }
  expect(worst).toBeLessThan(.001);
});

test("unreachable authored hand positions report each error while feet still fit and all limb lengths remain real", () => {
  let worst = 0;
  for (const body of pack.header.rigs) {
    const rest = Float32Array.from(body.rest), residual = new Float64Array(4);
    for (const proportions of looks()) {
      const f = fixture(rest, proportions), pelvis = [...f.solved.pos.subarray(0, 3)], lengths = pairs.map(([a, b]) => distance(f.solved.pos, a, b));
      const error = fitRiderControls(f.pose, f.solved, rest, f.scale, stego, true, residual);
      worst = Math.max(worst, error);
      expect(error).toBe(Math.max(...residual)); expect(residual[2]).toBeLessThan(.001); expect(residual[3]).toBeLessThan(.001);
      expect([...f.solved.pos.subarray(0, 3)]).toEqual(pelvis); expect([...f.solved.pos, ...f.solved.rot].every(Number.isFinite)).toBe(true);
      pairs.forEach(([a, b], i) => expect(distance(f.solved.pos, a, b)).toBeCloseTo(lengths[i]!, 5));
    }
  }
  // The original source's low/forward grips are beyond a short rider's reach: content must move them.
  expect(worst).toBeGreaterThan(.1);
});

test("passenger fitting preserves its armed upper pose exactly while fitting only the two ankle supports", () => {
  const rest = Float32Array.from(pack.header.rigs[0]!.rest), f = fixture(rest);
  quatAxis(f.pose.rot, B_UPPER_ARM_L * 4, 0, 1, 0, .4); quatAxis(f.pose.rot, B_HAND_R * 4, 1, 0, 0, -.7);
  solve(HUMAN, f.pose, f.solved, rest, f.scale);
  const before = f.pose.rot.slice(), residual = new Float64Array(4);
  expect(fitRiderControls(f.pose, f.solved, rest, f.scale, trike, false, residual)).toBeLessThan(.001);
  for (let bone = B_HIPS; bone < B_UPPER_LEG_L; bone++) for (let axis = 0; axis < 4; axis++) expect(f.pose.rot[bone * 4 + axis]).toBe(before[bone * 4 + axis]);
  for (let bone = 22; bone < HUMAN_BONES; bone++) for (let axis = 0; axis < 4; axis++) expect(f.pose.rot[bone * 4 + axis]).toBe(before[bone * 4 + axis]);
  expect([...residual.slice(0, 2)]).toEqual([0, 0]);
});

test("zero-distance targets, straight poles and invalid content remain finite and never translate or scale a bone", () => {
  const rest = Float32Array.from(pack.header.rigs[0]!.rest), f = fixture(rest), t = trike.slice(), residual = new Float64Array(4);
  const pelvis = [...f.solved.pos.subarray(0, 3)], lengths = pairs.map(([a, b]) => distance(f.solved.pos, a, b));
  t.set(f.solved.pos.subarray(B_UPPER_LEG_L * 3, B_UPPER_LEG_L * 3 + 3), 7);
  t.set(t.subarray(7, 10), 13); // A pole on the reach axis uses the stable outward fallback.
  t[1] = NaN;
  const leftArm = f.pose.rot.slice(B_UPPER_ARM_L * 4, (B_HAND_L + 1) * 4);
  expect(fitRiderControls(f.pose, f.solved, rest, f.scale, t, true, residual)).toBe(Infinity);
  expect([...f.pose.rot.slice(B_UPPER_ARM_L * 4, (B_HAND_L + 1) * 4)]).toEqual([...leftArm]);
  expect([...f.solved.pos.subarray(0, 3)]).toEqual(pelvis); expect([...f.solved.pos, ...f.solved.rot].every(Number.isFinite)).toBe(true);
  pairs.forEach(([a, b], i) => expect(distance(f.solved.pos, a, b)).toBeCloseTo(lengths[i]!, 5));
  expect(residual[0]).toBe(Infinity); expect(Number.isFinite(residual[2])).toBe(true);
});

test("independent client and server calls produce identical poses and repeated fitting does not drift", () => {
  const rest = Float32Array.from(pack.header.rigs[1]!.rest), a = fixture(rest), b = fixture(rest);
  const error = fitRiderControls(a.pose, a.solved, rest, a.scale, trike);
  const other = fitRiderControls(b.pose, b.solved, rest, b.scale, trike);
  expect(error).toBe(other); expect([...a.pose.rot]).toEqual([...b.pose.rot]); expect([...a.solved.pos]).toEqual([...b.solved.pos]);
  const before = a.solved.pos.slice();
  for (let n = 0; n < 20; n++) fitRiderControls(a.pose, a.solved, rest, a.scale, trike);
  for (let i = 0; i < before.length; i++) expect(a.solved.pos[i]).toBeCloseTo(before[i]!, 6);
});

test("default poles bend outward, authored poles redirect knees, and absent groups preserve the original limbs", () => {
  const rest = Float32Array.from(pack.header.rigs[0]!.rest), f = fixture(rest), t = trike.slice();
  t[0] = RIDER_HANDS | RIDER_FEET;
  expect(fitRiderControls(f.pose, f.solved, rest, f.scale, t)).toBeLessThan(.001);
  for (const [upper, bend, sign] of [[B_UPPER_ARM_L, B_LOWER_ARM_L, 1], [B_UPPER_ARM_R, B_LOWER_ARM_R, -1], [B_UPPER_LEG_L, B_LOWER_LEG_L, 1], [B_UPPER_LEG_R, B_LOWER_LEG_R, -1]] as const) expect((f.solved.pos[bend * 3]! - f.solved.pos[upper * 3]!) * sign).toBeGreaterThan(.04);
  const knee = f.solved.pos.slice(B_LOWER_LEG_L * 3, B_LOWER_LEG_L * 3 + 3), upper = f.pose.rot.slice(0, B_UPPER_LEG_L * 4);
  t[0] = RIDER_FEET | RIDER_KNEES; t[15] = t[18] = 1;
  expect(fitRiderControls(f.pose, f.solved, rest, f.scale, t)).toBeLessThan(.001);
  expect([...f.pose.rot.slice(0, B_UPPER_LEG_L * 4)]).toEqual([...upper]);
  expect(Math.hypot(...knee.map((value, axis) => value - f.solved.pos[B_LOWER_LEG_L * 3 + axis]!))).toBeGreaterThan(.05);
  const saved = f.pose.rot.slice(); t[0] = 0;
  expect(fitRiderControls(f.pose, f.solved, rest, f.scale, t)).toBe(0); expect([...f.pose.rot]).toEqual([...saved]);
});
