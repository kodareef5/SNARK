import { expect, test } from "bun:test";
import { Pose } from "../../shared/anim/clip.ts";
import { B_FOOT_L, B_LOWER_LEG_L, B_UPPER_LEG_L, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { aimBone, foldReach, toward, twoBone } from "../../shared/anim/ik.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { quatRotate } from "../../shared/math/quat.ts";

const out = new Float64Array(6);
const gap = (x: number, y: number, z: number, at: number): number => Math.hypot(out[at]! - x, out[at + 1]! - y, out[at + 2]! - z);
/** The fold of the middle joint, in radians: 0 straight. */
const fold = (s: readonly number[]): number => {
  const ux = out[3]! - s[0]!, uy = out[4]! - s[1]!, uz = out[5]! - s[2]!, lx = out[0]! - out[3]!, ly = out[1]! - out[4]!, lz = out[2]! - out[5]!;
  return Math.acos((ux * lx + uy * ly + uz * lz) / Math.hypot(ux, uy, uz) / Math.hypot(lx, ly, lz));
};

test("a two-bone reach lands on a reachable goal and keeps both bone lengths", () => {
  const short = twoBone(out, 0, 0, 1, 0, .3, .4, .5, .45, .42, 0, 1, 0);
  expect(short).toBeLessThan(1e-12);
  expect(gap(.3, .4, .5, 0)).toBeLessThan(1e-12);
  expect(gap(0, 1, 0, 3)).toBeCloseTo(.45, 12);
  expect(gap(.3, .4, .5, 3)).toBeCloseTo(.42, 12);
  // The middle joint bends toward the pole's side of the reach.
  expect(out[4]!).toBeGreaterThan((1 + .4) / 2);
});

test("an unreachable goal is approached short of straight and the shortfall returned", () => {
  const short = twoBone(out, 0, 0, 0, 0, 0, 0, 2, .45, .42, 0, 1, 0);
  expect(short).toBeCloseTo(2 - (.87 - .002), 9);
  expect(gap(0, 0, 0, 0)).toBeCloseTo(.87 - .002, 9);
  expect(twoBone(out, 0, 0, 0, 0, 0, 0, 0, .45, .42, 0, 1, 0)).toBe(-1);
});

test("the fold range holds the middle joint between its least and most fold", () => {
  const least = .3, most = 2;
  // A goal close to the root wants the joint folded past its most.
  twoBone(out, 0, 0, 0, 0, 0, 0, .05, .45, .42, 0, 1, 0, .002, Math.cos(least), Math.cos(most));
  expect(fold([0, 0, 0])).toBeCloseTo(most, 9);
  // A far goal wants it straight, past its least.
  twoBone(out, 0, 0, 0, 0, 0, 0, .9, .45, .42, 0, 1, 0, .002, Math.cos(least), Math.cos(most));
  expect(fold([0, 0, 0])).toBeCloseTo(least, 9);
  expect(foldReach(.45, .42, 1)).toBeCloseTo(.87, 12);
  expect(foldReach(.45, .42, -1)).toBeCloseTo(.03, 12);
});

test("a pole along the reach gives way to a side, so the joint still bends", () => {
  twoBone(out, 0, 0, 0, 0, 0, -.5, 0, .45, .42, 0, -1, 0);
  expect(Math.abs(out[3]!)).toBeGreaterThan(.1);
  expect([...out].every(Number.isFinite)).toBe(true);
});

test("toward turns one direction onto another, opposite ones included", () => {
  const q = new Float64Array(4), v = new Float64Array(3);
  for (const [a, b] of [[[1, 0, 0], [0, 0, 2]], [[0, 1, 0], [0, -3, 0]], [[.3, -.2, .9], [-.3, .2, -.9]]] as const) {
    toward(q, 0, a[0], a[1], a[2], b[0], b[1], b[2]);
    quatRotate(q, 0, a[0], a[1], a[2], v, 0);
    const scale = Math.hypot(...a) / Math.hypot(...b);
    for (let k = 0; k < 3; k++) expect(v[k]!).toBeCloseTo(b[k]! * scale, 9);
  }
});

test("aiming a thigh keeps its length and puts the knee on the new line", () => {
  const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES);
  solve(HUMAN, pose, solved);
  const hip = [...solved.pos.subarray(B_UPPER_LEG_L * 3, B_UPPER_LEG_L * 3 + 3)];
  const from = [0, 1, 2].map(k => solved.pos[B_LOWER_LEG_L * 3 + k]! - hip[k]!);
  aimBone(HUMAN, pose, solved, B_UPPER_LEG_L, from[0]!, from[1]!, from[2]!, 0, -.3, 1);
  solve(HUMAN, pose, solved);
  const knee = [0, 1, 2].map(k => solved.pos[B_LOWER_LEG_L * 3 + k]! - hip[k]!), length = Math.hypot(...from);
  expect(Math.hypot(...knee)).toBeCloseTo(length, 5);
  expect(knee[1]! / knee[2]!).toBeCloseTo(-.3, 4);
  expect(solved.pos[B_FOOT_L * 3 + 2]!).toBeGreaterThan(.3);
});
