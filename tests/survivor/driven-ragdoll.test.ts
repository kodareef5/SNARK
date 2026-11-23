// A living body on the ragdoll solver (shared/anim/ragdoll.ts): anchors follow their target, drives spring the rest back
// to it after a blow, limits and limb pairs still hold, and the same inputs give the same body.
import { expect, test } from "bun:test";
import { HUMAN, HUMAN_RAGDOLL } from "../../shared/anim/human.ts";
import { standingPose } from "../../shared/anim/human-fall.ts";
import { Ragdoll } from "../../shared/anim/ragdoll.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { Solved, boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { B_UPPER_ARM_L } from "../../shared/anim/human.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const STEP = 1 / 30;
const HIPS = 0, CHEST = 1, HEAD = 2, FOREARM_L = 4;
const LEGS = [7, 8, 9, 10];

function flat() {
  const dims = { chunksX: 2, chunksZ: 2 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  return { hf, structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
}

/** A survivor standing at (40, ground, 40) with its hips and legs anchored and the rest driven at `omega`. */
function standing(w: ReturnType<typeof flat>, omega = 25, target = standingPose()): Ragdoll {
  const r = new Ragdoll(HUMAN, HUMAN_RAGDOLL);
  r.start(target, target, 40, w.hf.heightAt(40, 40), 40, 0.6, 1);
  for (const i of [HIPS, ...LEGS]) r.anchor(i, true);
  for (let i = 0; i < r.n; i++) if (!r.anchored[i]) { r.driveOmega[i] = omega; r.driveZeta[i] = 1; }
  r.lift = 1;
  return r;
}

/** The angle in radians between a body's turn against its parent and its drive's target. */
function off(r: Ragdoll, i: number): number {
  const q = new Float64Array(4);
  r.offset(i, q, 0);
  const w = Math.min(1, Math.abs(q[3]!));
  return 2 * Math.acos(w);
}

test("a struck chest springs back to its target within a second", () => {
  const w = flat(), r = standing(w), target = standingPose();
  r.strike(CHEST, 1.5, 0, 0);
  let peak = 0;
  for (let f = 1; f <= 30; f++) {
    r.follow(target, 40, w.hf.heightAt(40, 40), 40, 0.6);
    r.step(w, STEP);
    peak = Math.max(peak, off(r, CHEST), off(r, HEAD));
  }
  expect(peak).toBeGreaterThan(0.1);
  expect(off(r, CHEST)).toBeLessThan(0.02);
  expect(off(r, HEAD)).toBeLessThan(0.03);
});

test("anchors end every step exactly where the target puts them", () => {
  const w = flat(), r = standing(w), target = standingPose();
  const fresh = new Ragdoll(HUMAN, HUMAN_RAGDOLL);
  for (let f = 1; f <= 20; f++) {
    const x = 40 + f * 0.15, y = w.hf.heightAt(x, 40);
    r.follow(target, x, y, 40, 0.6);
    r.step(w, STEP);
    // A body started at the same place puts its hips where the anchor should be.
    fresh.start(target, target, x, y, 40, 0.6, 1);
    for (const i of [HIPS, ...LEGS]) for (let a = 0; a < 3; a++) expect(r.x[i * 3 + a]!).toBeCloseTo(fresh.x[i * 3 + a]!, 9);
  }
});

test("a driven body walked along keeps its upper body over its hips", () => {
  const w = flat(), r = standing(w), target = standingPose();
  for (let f = 1; f <= 60; f++) {
    const x = 40 + f * 0.2;
    r.follow(target, x, w.hf.heightAt(x, 40), 40, 0.6);
    r.step(w, STEP);
  }
  expect(off(r, CHEST)).toBeLessThan(0.05);
  expect(Math.abs(r.x[CHEST * 3]! - r.x[HIPS * 3]!)).toBeLessThan(0.1);
});

test("joint limits hold when a driven arm is struck hard", () => {
  const w = flat(), r = standing(w), target = standingPose();
  r.strike(FOREARM_L, 0, 3, -3);
  let past = 0;
  for (let f = 1; f <= 30; f++) {
    r.follow(target, 40, w.hf.heightAt(40, 40), 40, 0.6);
    r.step(w, STEP);
    for (let i = 1; i < r.n; i++) {
      const [swing, twist] = r.bend(i);
      past = Math.max(past, swing - r.swingNow[i]!, twist - r.twistNow[i]!);
    }
  }
  expect(past).toBeLessThan(0.05);
});

test("turning the walker leaves every limb where it was against its parent", () => {
  const w = flat(), r = standing(w), target = standingPose();
  r.strike(CHEST, 0.4, 0, 0.2);
  for (let f = 0; f < 5; f++) { r.follow(target, 40, w.hf.heightAt(40, 40), 40, 0.6); r.step(w, STEP); }
  const before = Array.from({ length: r.n }, (_, i) => off(r, i));
  const out = Math.hypot(r.x[CHEST * 3]! - 40, r.x[CHEST * 3 + 2]! - 40), height = r.x[CHEST * 3 + 1]!;
  r.turnAbout(40, 40, 1.4);
  for (let i = 0; i < r.n; i++) expect(off(r, i)).toBeCloseTo(before[i]!, 9);
  // The chest swung about the upright line, as far out and as high as before.
  expect(Math.hypot(r.x[CHEST * 3]! - 40, r.x[CHEST * 3 + 2]! - 40)).toBeCloseTo(out, 12);
  expect(r.x[CHEST * 3 + 1]!).toBe(height);
});

/** How far two bodies' capsules overlap, from the pose the ragdoll draws. */
function overlap(r: Ragdoll, a: number, b: number): number {
  const s = new Solved(HUMAN.bones);
  r.pose(s);
  const ends = (i: number) => {
    const bone = HUMAN_RAGDOLL.bone[i]!, p = new Float64Array(3), q = new Float64Array(3);
    boneToModel(s, bone, HUMAN.capA[bone * 3]!, HUMAN.capA[bone * 3 + 1]!, HUMAN.capA[bone * 3 + 2]!, p);
    boneToModel(s, bone, HUMAN.capB[bone * 3]!, HUMAN.capB[bone * 3 + 1]!, HUMAN.capB[bone * 3 + 2]!, q);
    return [p, q, HUMAN.capR[bone]!] as const;
  };
  const [p1, q1, r1] = ends(a), [p2, q2, r2] = ends(b);
  let gap = Infinity;
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) {
    const d = [0, 1, 2].map(k => p1[k]! + (q1[k]! - p1[k]!) * i / 40 - p2[k]! - (q2[k]! - p2[k]!) * j / 40);
    gap = Math.min(gap, Math.hypot(d[0]!, d[1]!, d[2]!));
  }
  return r1 + r2 - gap;
}

test("an arm driven down across the hips stays out of them", () => {
  const w = flat();
  // The left arm swung down and in, past the side and through the hips.
  const pose = new Pose(HUMAN.bones);
  pose.rot.set([0, 0, Math.sin(-1.0), Math.cos(-1.0)], B_UPPER_ARM_L * 4);
  const through = new Solved(HUMAN.bones);
  solve(HUMAN, pose, through);
  const run = (paired: boolean) => {
    const r = new Ragdoll(HUMAN, paired ? HUMAN_RAGDOLL : { ...HUMAN_RAGDOLL, pairs: undefined });
    r.start(standingPose(), standingPose(), 40, w.hf.heightAt(40, 40), 40, 0.6, 1);
    for (const i of [HIPS, ...LEGS]) r.anchor(i, true);
    for (let i = 0; i < r.n; i++) if (!r.anchored[i]) { r.driveOmega[i] = 30; r.driveZeta[i] = 1; }
    r.lift = 1;
    for (let f = 1; f <= 45; f++) { r.follow(through, 40, w.hf.heightAt(40, 40), 40, 0.6); r.step(w, STEP); }
    return Math.max(overlap(r, FOREARM_L, HIPS), overlap(r, FOREARM_L, CHEST));
  };
  const loose = run(false), paired = run(true);
  expect(loose).toBeGreaterThan(0.06);
  expect(paired).toBeLessThan(0.03);
});

test("the same anchors, drives and blow give the same body twice", () => {
  const w = flat(), target = standingPose();
  const [a, b] = [standing(w), standing(w)];
  for (const r of [a, b]) r.strike(HEAD, -0.3, 0.1, 0.5);
  for (let f = 1; f <= 40; f++) {
    for (const r of [a, b]) { r.follow(target, 40 + f * 0.05, 0, 40, 0.6 + f * 0.01); r.step(w, STEP); }
  }
  expect([...a.checkpoint()]).toEqual([...b.checkpoint()]);
});
