import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { Pose } from "../../shared/anim/clip.ts";
import { B_HAND_L, B_HAND_R, B_HIPS, B_LOWER_ARM_L, B_LOWER_ARM_R, B_PROP_L, B_PROP_R, B_UPPER_ARM_L, B_UPPER_ARM_R, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { defaultLook, REGION_COUNT, lookScales, setRegion } from "../../shared/anim/look.ts";
import { fitPilotControls } from "../../shared/anim/mount-controls.ts";
import { createMountMotion, mountPose } from "../../shared/anim/mount.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { quatAxis, quatRotate } from "../../shared/math/quat.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { fromArt, test } from "../fixtures/needs-art.ts";

const pack = fromArt(() => parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk", import.meta.url)))));
const left = { position: [.28, .20, .22] }, right = { position: [-.14, .26, .32] };
function fixture(rest: Float32Array, proportions: number[]) {
  const look = defaultLook(), scale = new Float32Array(HUMAN_BONES * 3), pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES);
  proportions.forEach((value, region) => setRegion(look, region, value));
  lookScales(look, scale);
  mountPose(createMountMotion(), { role: "pilot", tick: 0, startTick: 0, durationTicks: 1 }, pose);
  solve(HUMAN, pose, solved, rest, scale);
  return { pose, solved, scale };
}
function distance(p: Float32Array, a: number, b: number): number { return Math.hypot(p[a * 3]! - p[b * 3]!, p[a * 3 + 1]! - p[b * 3 + 1]!, p[a * 3 + 2]! - p[b * 3 + 2]!); }

test("actual male and female pilot proportions reach both controls without stretching arms or moving the pelvis", () => {
  let worst = 0;
  for (const body of pack.header.rigs) {
    const rest = Float32Array.from(body.rest);
    const looks = [-1, 0, 1].map(value => new Array<number>(REGION_COUNT).fill(value));
    for (let region = 0; region < REGION_COUNT; region++) for (const value of [-1, 1]) looks.push(Array.from({ length: REGION_COUNT }, (_, r) => r === region ? value : -value));
    for (const proportions of looks) {
      const { pose, solved, scale } = fixture(rest, proportions), hips = [...solved.pos.subarray(0, 3)];
      const lengths = [[B_UPPER_ARM_L, B_LOWER_ARM_L], [B_LOWER_ARM_L, B_HAND_L], [B_UPPER_ARM_R, B_LOWER_ARM_R], [B_LOWER_ARM_R, B_HAND_R]].map(([a, b]) => distance(solved.pos, a!, b!));
      worst = Math.max(worst, fitPilotControls(pose, solved, rest, scale, left, right));
      expect([...solved.pos.subarray(B_HIPS * 3, B_HIPS * 3 + 3)]).toEqual(hips);
      [[B_UPPER_ARM_L, B_LOWER_ARM_L], [B_LOWER_ARM_L, B_HAND_L], [B_UPPER_ARM_R, B_LOWER_ARM_R], [B_LOWER_ARM_R, B_HAND_R]].forEach(([a, b], i) => expect(distance(solved.pos, a!, b!)).toBeCloseTo(lengths[i]!, 5));
      for (const [prop, control] of [[B_PROP_L, left], [B_PROP_R, right]] as const) for (let axis = 0; axis < 3; axis++) expect(solved.pos[prop * 3 + axis]! - hips[axis]!).toBeCloseTo(control.position[axis]!, 4);
    }
  }
  expect(worst).toBeLessThan(.001);
});

test("a moving cyclic turns the hand with its grip, while an unreachable target leaves a finite bounded pose", () => {
  const rest = Float32Array.from(pack.header.rigs[0]!.rest), rotation = new Float64Array(4);
  const { pose, solved, scale } = fixture(rest, new Array<number>(REGION_COUNT).fill(0));
  quatAxis(rotation, 0, 1, 0, 0, .1);
  expect(fitPilotControls(pose, solved, rest, scale, left, { position: [-.15, .23, .40], rotation })).toBeLessThan(.001);
  const hips = [...solved.pos.subarray(0, 3)];
  expect(fitPilotControls(pose, solved, rest, scale, { position: [50, 0, 0] }, right)).toBeGreaterThan(49);
  expect([...solved.pos, ...solved.rot].every(Number.isFinite)).toBe(true);
  expect([...solved.pos.subarray(0, 3)]).toEqual(hips);
  expect(distance(solved.pos, B_UPPER_ARM_L, B_HAND_L)).toBeLessThan(.6);
});

test("the helm reaches its full steering arc with mirrored inward palms and unchanged arm lengths", () => {
  const rotation = new Float64Array(4), palm = new Float64Array(3), fingers = new Float64Array(3);
  let worst = 0;
  for (const body of pack.header.rigs) {
    const rest = Float32Array.from(body.rest);
    const looks = [-1, 0, 1].map(value => new Array<number>(REGION_COUNT).fill(value));
    for (let region = 0; region < REGION_COUNT; region++) for (const value of [-1, 1]) looks.push(Array.from({ length: REGION_COUNT }, (_, r) => r === region ? value : -value));
    for (const proportions of looks) for (const angle of [-.65, 0, .65]) {
      const { pose, solved, scale } = fixture(rest, proportions), hips = [...solved.pos.subarray(0, 3)];
      const lengths = [[B_UPPER_ARM_L, B_LOWER_ARM_L], [B_LOWER_ARM_L, B_HAND_L], [B_UPPER_ARM_R, B_LOWER_ARM_R], [B_LOWER_ARM_R, B_HAND_R]].map(([a, b]) => distance(solved.pos, a!, b!));
      quatAxis(rotation, 0, 0, 0, 1, angle);
      const controls = [1, -1].map(side => ({ position: [side * .18 * Math.cos(angle), .36 + side * .18 * Math.sin(angle), .27], rotation }));
      worst = Math.max(worst, fitPilotControls(pose, solved, rest, scale, controls[0]!, controls[1]!, "helm"));
      expect([...solved.pos.subarray(B_HIPS * 3, B_HIPS * 3 + 3)]).toEqual(hips);
      [[B_UPPER_ARM_L, B_LOWER_ARM_L], [B_LOWER_ARM_L, B_HAND_L], [B_UPPER_ARM_R, B_LOWER_ARM_R], [B_LOWER_ARM_R, B_HAND_R]].forEach(([a, b], i) => expect(distance(solved.pos, a!, b!)).toBeCloseTo(lengths[i]!, 5));
      for (const [side, hand, prop] of [[1, B_HAND_L, B_PROP_L], [-1, B_HAND_R, B_PROP_R]] as const) {
        const control = controls[side === 1 ? 0 : 1]!;
        for (let axis = 0; axis < 3; axis++) expect(solved.pos[prop * 3 + axis]! - hips[axis]!).toBeCloseTo(control.position[axis]!, 4);
        quatRotate(solved.rot, hand * 4, 0, -1, 0, palm, 0);
        expect(palm[0]).toBeCloseTo(-side * Math.cos(angle), 5);
        expect(palm[1]).toBeCloseTo(-side * Math.sin(angle), 5);
        expect(palm[2]).toBeCloseTo(0, 5);
        quatRotate(solved.rot, hand * 4, side, 0, 0, fingers, 0);
        expect(fingers[2]).toBeCloseTo(1, 5);
      }
    }
  }
  expect(worst).toBeLessThan(.001);
});
