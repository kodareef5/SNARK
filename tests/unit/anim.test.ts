import { expect, test } from "bun:test";
import { NO_CLIPS, Pose, blendPose, sampleClip } from "../../shared/anim/clip.ts";
import {
  B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_HIPS, B_LOWER_LEG_L, B_SHOULDER_L, B_SHOULDER_R, B_UPPER_ARM_L, B_UPPER_ARM_R,
  HUMAN, HUMAN_BONES, SOCKET_EYE, ZONE_ARM_L, ZONE_FOOT_R, ZONE_HAND_L, ZONE_HAND_R, ZONE_HEAD, ZONE_LEG_L, ZONE_TORSO,
} from "../../shared/anim/human.ts";
import { AnimState, HumanAnim, humanPose } from "../../shared/anim/pose.ts";
import { STANCE_CROUCH, STANCE_PRONE } from "../../shared/sim/character.ts";
import { Solved, boneToModel, rayCapsule, rayZones, solve, zoneHit } from "../../shared/anim/skeleton.ts";
import { Rng } from "../../shared/rng.ts";
import { quatAxis, quatMul, quatMulConj, quatNlerp, quatRotate, quatUnrotate } from "../../shared/math/quat.ts";
import { coreAnim } from "../fixtures/pack.ts";

const HALF_TURN = Math.PI;

function solved(st: AnimState, tick: number, anim = coreAnim()): Solved {
  const pose = new Pose(HUMAN_BONES);
  const out = new Solved(HUMAN_BONES);
  humanPose(anim, st, tick, pose);
  solve(HUMAN, pose, out);
  return out;
}

const y = (s: Solved, bone: number): number => s.pos[bone * 3 + 1]!;
const z = (s: Solved, bone: number): number => s.pos[bone * 3 + 2]!;
const x = (s: Solved, bone: number): number => s.pos[bone * 3]!;

test("quaternions turn the right way and compose in order", () => {
  const q = new Float64Array(4);
  const v = new Float64Array(3);
  // A quarter turn about +Y carries +Z to +X: the same sense as yaw.
  quatAxis(q, 0, 0, 1, 0, HALF_TURN / 2);
  quatRotate(q, 0, 0, 0, 1, v, 0);
  expect([...v].map((n) => +n.toFixed(6) + 0)).toEqual([1, 0, 0]);
  quatUnrotate(q, 0, 1, 0, 0, v, 0);
  expect([...v].map((n) => +n.toFixed(6) + 0)).toEqual([0, 0, 1]);
  // a * b applies b first: tip +Z down to -Y about +X, then turn about +Y, which leaves -Y alone.
  const a = new Float64Array(4);
  const b = new Float64Array(4);
  quatAxis(a, 0, 0, 1, 0, HALF_TURN / 2);
  quatAxis(b, 0, 1, 0, 0, HALF_TURN / 2);
  quatMul(q, 0, a, 0, b, 0);
  quatRotate(q, 0, 0, 0, 1, v, 0);
  expect([...v].map((n) => +n.toFixed(6) + 0)).toEqual([0, -1, 0]);
  // conj(a) * (a * b) is b again.
  quatMulConj(q, 0, a, 0, q, 0);
  for (let k = 0; k < 4; k++) expect(q[k]!).toBeCloseTo(b[k]!, 9);
  // Halfway between no turn and a quarter turn is an eighth, by the short way even from the far side.
  quatAxis(a, 0, 0, 1, 0, 0);
  quatAxis(b, 0, 0, 1, 0, HALF_TURN / 2);
  for (let k = 0; k < 4; k++) b[k] = -b[k]!;
  quatNlerp(q, 0, a, 0, b, 0, 0.5);
  quatRotate(q, 0, 0, 0, 1, v, 0);
  expect(v[0]!).toBeCloseTo(Math.SQRT1_2, 6);
  expect(v[2]!).toBeCloseTo(Math.SQRT1_2, 6);
});

test("the skeleton is a tree in order, mirrored left to right, with a capsule on every bone that can be hit", () => {
  const s = HUMAN;
  expect(s.bones).toBe(28);
  expect(s.names[B_HIPS]).toBe("hips");
  expect(s.names[B_UPPER_ARM_R]).toBe("upperArm.R");
  for (let b = 0; b < s.bones; b++) expect(s.parent[b]!).toBeLessThan(b);
  expect(s.parent[B_UPPER_ARM_R]).toBe(B_SHOULDER_R);
  // The body's left is +X.
  expect(s.rest[B_HAND_L * 3]!).toBeGreaterThan(0.6);
  for (const [l, r] of [[B_SHOULDER_L, B_SHOULDER_R], [B_HAND_L, B_HAND_R], [B_FOOT_L, B_FOOT_R]] as const) {
    expect(s.rest[r * 3]).toBe(-s.rest[l * 3]!);
    expect(s.rest[r * 3 + 1]).toBe(s.rest[l * 3 + 1]!);
    expect(s.capA[r * 3]! + s.capA[l * 3]!).toBe(0);
    expect(s.capB[r * 3 + 1]).toBe(s.capB[l * 3 + 1]!);
    expect(s.capR[r]).toBe(s.capR[l]!);
  }
  for (let b = 0; b < s.bones; b++) {
    if (b < s.zoneBones) {
      expect(s.zone[b]!).toBeGreaterThan(0);
      expect(s.capR[b]!).toBeGreaterThan(0.04);
    } else expect(s.zone[b]).toBe(0);
  }
  expect(s.zone[B_HAND_R]).toBe(ZONE_HAND_R);
  expect(s.zone[B_FOOT_R]).toBe(ZONE_FOOT_R);
  // The eye socket is at the survivor's eye height when it stands at rest.
  const rest = new Solved(HUMAN_BONES);
  solve(s, new Pose(HUMAN_BONES), rest);
  const eye = [0, 0, 0];
  boneToModel(rest, SOCKET_EYE.bone, SOCKET_EYE.x, SOCKET_EYE.y, SOCKET_EYE.z, eye);
  expect(eye[1]!).toBeCloseTo(1.62, 2);
  for (let b = 0; b < s.bones; b++) for (let k = 0; k < 3; k++) expect(rest.pos[b * 3 + k]!).toBeCloseTo(s.rest[b * 3 + k]!, 6);
});

test("without clips a body rests in a T-pose; with them it stands with its arms down and its feet on the ground", () => {
  const st = new AnimState();
  const t = solved(st, 0, new HumanAnim(NO_CLIPS));
  expect(y(t, B_HAND_L)).toBeCloseTo(y(t, B_UPPER_ARM_L), 6);
  expect(x(t, B_HAND_L)).toBeGreaterThan(0.6);

  const anim = coreAnim();
  for (const clip of [anim.idle, anim.walk, anim.jog, anim.sprint, anim.fall, anim.swim, anim.swimIdle, anim.crouchIdle, anim.crouchWalk]) expect(clip).not.toBeNull();
  for (const tick of [0, 13, 40.5, 71]) {
    const s = solved(st, tick);
    expect(y(s, B_HAND_L)).toBeLessThan(y(s, B_UPPER_ARM_L) - 0.35);
    expect(y(s, B_HAND_R)).toBeLessThan(y(s, B_UPPER_ARM_R) - 0.35);
    expect(Math.abs(x(s, B_HAND_L))).toBeLessThan(0.45);
    // Ankles stay where they rest, within a few centimetres: the feet neither float nor sink.
    for (const foot of [B_FOOT_L, B_FOOT_R]) expect(Math.abs(y(s, foot) - HUMAN.rest[foot * 3 + 1]!)).toBeLessThan(0.05);
    expect(y(s, B_HEAD)).toBeGreaterThan(1.42);
  }
});

test("a pose depends only on its inputs, and bodies with different seeds are out of step", () => {
  const st = new AnimState();
  st.speed = 7;
  st.seed = 123;
  const a = solved(st, 500.25);
  solved(new AnimState(), 3); // other work in between leaves nothing behind
  const b = solved(st, 500.25);
  expect([...b.pos]).toEqual([...a.pos]);
  expect([...b.rot]).toEqual([...a.rot]);
  st.seed = 130;
  expect(solved(st, 500.25).pos[B_FOOT_L * 3 + 2]).not.toBe(a.pos[B_FOOT_L * 3 + 2]!);
  // The same moment reached through tick or through seed is the same pose.
  st.seed = 123 + 7;
  const c = solved(st, 493.25);
  expect([...c.pos]).toEqual([...a.pos]);
});

test("gaits stride in step: left foot ahead at the start of every cycle, right foot half a cycle later", () => {
  const st = new AnimState();
  for (const [speed, cycle] of [[3, 32], [7, 22], [12, 18]] as const) {
    st.speed = speed;
    const start = solved(st, 0);
    const half = solved(st, cycle / 2);
    expect(z(start, B_FOOT_L) - z(start, B_FOOT_R)).toBeGreaterThan(0.25);
    expect(z(half, B_FOOT_R) - z(half, B_FOOT_L)).toBeGreaterThan(0.25);
    // One whole cycle later it is where it began.
    const again = solved(st, cycle);
    for (let k = 0; k < again.pos.length; k++) expect(again.pos[k]!).toBeCloseTo(start.pos[k]!, 5);
    // Faster gaits take longer strides, and the feet stay near the ground at the low point of a stride.
    let low = Infinity;
    for (let t = 0; t < cycle; t++) low = Math.min(low, y(solved(st, t), B_FOOT_L));
    expect(Math.abs(low - HUMAN.rest[B_FOOT_L * 3 + 1]!)).toBeLessThan(0.08);
  }
});

test("moving sideways turns the hips toward the way it goes and leaves the head facing forward", () => {
  const st = new AnimState();
  st.speed = 7;
  const forward = new Float64Array(3);
  const hips = (s: Solved, bone: number): number[] => {
    quatRotate(s.rot, bone * 4, 0, 0, 1, forward, 0);
    return [...forward];
  };
  // Averaged over a cycle, so the swing of the gait itself cancels.
  const mean = (dir: number, bone: number): number[] => {
    st.dir = dir;
    const sum = [0, 0, 0];
    for (let t = 0; t < 22; t++) hips(solved(st, t), bone).forEach((v, k) => (sum[k]! += v / 22));
    return sum;
  };
  expect(mean(0, B_HIPS)[2]!).toBeGreaterThan(0.9);
  // To its left (+X): hips a quarter turn left, head still forward.
  expect(mean(4, B_HIPS)[0]!).toBeGreaterThan(0.85);
  expect(mean(4, B_HEAD)[2]!).toBeGreaterThan(0.85);
  // To its right.
  expect(mean(12, B_HIPS)[0]!).toBeLessThan(-0.85);
  // Backward: the hips face forward again and the gait runs in reverse.
  expect(mean(8, B_HIPS)[2]!).toBeGreaterThan(0.9);
  st.dir = 8;
  const back = solved(st, 3);
  st.dir = 0;
  const fore = solved(st, 22 - 3);
  for (let k = 0; k < back.pos.length; k++) expect(back.pos[k]!).toBeCloseTo(fore.pos[k]!, 5);
});

test("looking up tips the head back, crouching lowers it, lying prone and swimming lay the body flat", () => {
  const st = new AnimState();
  const v = new Float64Array(3);
  const facing = (s: Solved): number[] => {
    quatRotate(s.rot, B_HEAD * 4, 0, 0, 1, v, 0);
    return [...v];
  };
  const level = facing(solved(st, 0));
  st.pitch = 24;
  const up = facing(solved(st, 0));
  st.pitch = -24;
  const down = facing(solved(st, 0));
  expect(up[1]!).toBeGreaterThan(level[1]! + 0.6);
  expect(down[1]!).toBeLessThan(level[1]! - 0.6);

  const stand = solved(new AnimState(), 0);
  const low = new AnimState();
  low.stance = STANCE_CROUCH;
  expect(y(solved(low, 0), B_HEAD)).toBeLessThan(y(stand, B_HEAD) - 0.3);
  // Prone: everything within half a metre of the ground, head forward of the feet, face level and looking ahead.
  low.stance = STANCE_PRONE;
  for (const speed of [0, 1]) {
    low.speed = speed;
    for (const tick of [0, 10, 20, 30]) {
      const flat = solved(low, tick);
      for (let b = 0; b < HUMAN_BONES; b++) {
        expect(y(flat, b)).toBeLessThan(0.55);
        expect(y(flat, b)).toBeGreaterThan(-0.02);
      }
      expect(z(flat, B_HEAD) - z(flat, B_FOOT_L)).toBeGreaterThan(1.1);
      expect(facing(flat)[2]!).toBeGreaterThan(0.9);
    }
  }

  const swim = new AnimState();
  swim.mode = 2;
  swim.grounded = false;
  swim.speed = 4;
  const s = solved(swim, 10);
  // Head well ahead of the hips and not far above them.
  expect(z(s, B_HEAD) - z(s, B_HIPS)).toBeGreaterThan(0.4);
  expect(Math.abs(y(s, B_HEAD) - y(s, B_HIPS))).toBeLessThan(0.35);
  // Swimming upward tips the whole body about its middle.
  swim.pitch = 20;
  const rising = solved(swim, 10);
  expect(y(rising, B_HEAD) - y(rising, B_HIPS)).toBeGreaterThan(0.35);
});

test("a ray finds the zone it would hit on the posed body", () => {
  const st = new AnimState();
  const s = solved(st, 0);
  const cast = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number => rayZones(HUMAN, s, ox, oy, oz, dx, dy, dz, 20);
  // From the front, level, at the height of the head, the chest, a shin.
  expect(cast(0, y(s, B_HEAD) + 0.1, 5, 0, 0, -1)).toBe(ZONE_HEAD);
  expect(zoneHit.bone).toBe(B_HEAD);
  expect(zoneHit.t).toBeGreaterThan(4.7);
  expect(zoneHit.t).toBeLessThan(5);
  expect(cast(0, 1.2, 5, 0, 0, -1)).toBe(ZONE_TORSO);
  expect(cast(x(s, B_LOWER_LEG_L), 0.3, 5, 0, 0, -1)).toBe(ZONE_LEG_L);
  // Straight down from above: the head, not the torso under it.
  expect(cast(0, 5, z(s, B_HEAD), 0, -1, 0)).toBe(ZONE_HEAD);
  // From its left side at the height of the hanging hand: the hand comes before the leg behind it.
  expect(cast(3, y(s, B_HAND_L) - 0.05, z(s, B_HAND_L), -1, 0, 0)).toBe(ZONE_HAND_L);
  // Wide of the body, over it, and short of it: nothing.
  expect(cast(1.2, 1.2, 5, 0, 0, -1)).toBe(0);
  expect(cast(0, 2.2, 5, 0, 0, -1)).toBe(0);
  expect(rayZones(HUMAN, s, 0, 1.2, 5, 0, 0, -1, 4)).toBe(0);
  expect(zoneHit.bone).toBe(-1);
  // In a T-pose the arm is out to the side, where at idle there is nothing.
  const t = solved(st, 0, new HumanAnim(NO_CLIPS));
  expect(rayZones(HUMAN, t, 0.35, 1.387, 5, 0, 0, -1, 20)).toBe(ZONE_ARM_L);
  expect(cast(0.35, 1.387, 5, 0, 0, -1)).toBe(0);
});

test("sampling a clip between frames and blending poses stay on the short way round", () => {
  const anim = coreAnim();
  const clip = anim.walk!;
  const a = new Pose(HUMAN_BONES);
  const b = new Pose(HUMAN_BONES);
  const m = new Pose(HUMAN_BONES);
  sampleClip(clip, 3, a);
  sampleClip(clip, 4, b);
  sampleClip(clip, 3.5, m);
  for (let i = 0; i < HUMAN_BONES * 4; i += 4) {
    // Unit length, and no farther from either neighbour than they are from each other.
    const len = Math.hypot(m.rot[i]!, m.rot[i + 1]!, m.rot[i + 2]!, m.rot[i + 3]!);
    expect(len).toBeCloseTo(1, 5);
    const dot = (p: Pose, q: Pose): number => Math.abs(p.rot[i]! * q.rot[i]! + p.rot[i + 1]! * q.rot[i + 1]! + p.rot[i + 2]! * q.rot[i + 2]! + p.rot[i + 3]! * q.rot[i + 3]!);
    expect(dot(m, a)).toBeGreaterThanOrEqual(dot(a, b) - 1e-6);
  }
  // A loop wraps: the frame after the last is the first.
  sampleClip(clip, clip.frames, a);
  sampleClip(clip, 0, b);
  expect([...a.rot]).toEqual([...b.rot]);
  // A clip that does not loop holds its last frame.
  const once = coreAnim().set.clips[coreAnim().set.index.get("human/death")!]!;
  expect(once.loop).toBe(false);
  sampleClip(once, once.frames + 50, a);
  sampleClip(once, once.frames - 1, b);
  expect([...a.rot]).toEqual([...b.rot]);
  // Blending only some bones leaves the others and the root alone.
  sampleClip(clip, 0, a);
  sampleClip(clip, 10, b);
  const before = [...a.rot.slice(0, B_SHOULDER_L * 4)];
  const root = [...a.root];
  blendPose(a, a, b, 0.5, B_SHOULDER_L, B_HAND_R + 1);
  expect([...a.rot.slice(0, B_SHOULDER_L * 4)]).toEqual(before);
  expect([...a.root]).toEqual(root);
  expect(a.rot[B_UPPER_ARM_L * 4]).not.toBe(b.rot[B_UPPER_ARM_L * 4]!);
});

test("a pose state survives packing into the 31 bits that are replicated", () => {
  const a = new AnimState();
  const b = new AnimState();
  for (const [mode, grounded, stance, speed, dir, pitch, action, start] of [[1, true, 0, 0, 0, 0, 0, 0], [2, false, 0, 15, 15, -31, 31, 255], [1, false, 2, 7, 9, 31, 5, 128], [1, true, 1, 3, 4, -1, 0, 7]] as const) {
    a.mode = mode;
    a.grounded = grounded;
    a.stance = stance;
    a.speed = speed;
    a.dir = dir;
    a.pitch = pitch;
    a.action = action;
    a.actionStart = start;
    const word = a.pack();
    expect(word).toBeLessThan(2 ** 31);
    expect(word).toBeGreaterThanOrEqual(0);
    b.unpack(word);
    expect([b.mode, b.grounded, b.stance, b.speed, b.dir, b.pitch, b.action, b.actionStart]).toEqual([mode, grounded, stance, speed, dir, pitch, action, start]);
  }
  // A body at rest on the ground, looking level, doing nothing, is the number zero.
  expect(new AnimState().pack()).toBe(0);
  // Motion is read off a velocity and a facing: forward, to its left, backward, and its look.
  a.setMotion(0, 4.2, 0, 0.5);
  expect([a.speed, a.dir, a.pitch]).toEqual([7, 0, 10]);
  a.setMotion(4.2, 0, 0, 0);
  expect([a.speed, a.dir]).toEqual([7, 4]);
  a.setMotion(0, -7.2, 0, -Math.PI / 2);
  expect([a.speed, a.dir, a.pitch]).toEqual([12, 8, -31]);
  a.setMotion(-3, 0, Math.PI / 2, 0); // facing +X, moving -X: backward
  expect(a.dir).toBe(8);
  a.setMotion(0.1, 0.1, 0, 0);
  expect([a.speed, a.dir]).toEqual([0, 0]);
});

test("a ray meets a capsule where stepping along the ray first comes within its radius", () => {
  const rng = new Rng(31);
  let hits = 0;
  for (let i = 0; i < 4000; i++) {
    // Capsules of every proportion, some of them balls; rays from all around, some starting inside.
    const a = [rng.range(-0.3, 0.3), rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)];
    const b = i % 7 === 0 ? [...a] : [rng.range(-0.3, 0.3), rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)];
    const r = rng.range(0.03, 0.2);
    const o = [rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)];
    let d = [rng.range(-0.4, 0.4) - o[0]!, rng.range(-0.4, 0.4) - o[1]!, rng.range(-0.4, 0.4) - o[2]!];
    // Now and then straight along the capsule, which is the case its side cannot answer.
    if (i % 11 === 0 && i % 7 !== 0) d = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const l = Math.hypot(d[0]!, d[1]!, d[2]!);
    d = d.map((v) => v / l);
    const t = rayCapsule(o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!, a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, r);
    // Distance from a point to the segment a-b.
    const far = (p: number[]): number => {
      const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const ap = [p[0]! - a[0]!, p[1]! - a[1]!, p[2]! - a[2]!];
      const len = ab[0]! * ab[0]! + ab[1]! * ab[1]! + ab[2]! * ab[2]!;
      const s = len > 0 ? Math.min(1, Math.max(0, (ap[0]! * ab[0]! + ap[1]! * ab[1]! + ap[2]! * ab[2]!) / len)) : 0;
      return Math.hypot(ap[0]! - ab[0]! * s, ap[1]! - ab[1]! * s, ap[2]! - ab[2]! * s);
    };
    const at = (k: number): number[] => [o[0]! + d[0]! * k, o[1]! + d[1]! * k, o[2]! + d[2]! * k];
    if (t < 0) {
      // A miss: no point of the ray is inside.
      for (let k = 0; k <= 4; k += 0.01) expect(far(at(k))).toBeGreaterThan(r - 1e-6);
    } else {
      hits++;
      // A hit: that point is on the surface (or the start is inside), and nothing before it is inside.
      if (t === 0) expect(far(o)).toBeLessThanOrEqual(r + 1e-9);
      else expect(far(at(t))).toBeCloseTo(r, 6);
      for (let k = 0; k < t - 0.005; k += 0.01) expect(far(at(k))).toBeGreaterThan(r - 1e-6);
    }
  }
  expect(hits).toBeGreaterThan(500);
  expect(hits).toBeLessThan(3900);
});
