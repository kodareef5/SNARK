import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CreatureAnim, creaturePose, advanceCreature } from '../../shared/anim/creature.ts';
import { groundMountMotion, groundMountPose } from '../../shared/anim/ground-mount.ts';
import { Gait } from '../../shared/anim/gait.ts';
import { AnimState } from '../../shared/anim/pose.ts';
import { buildRigs } from '../../shared/anim/rigs.ts';
import { SEAT_FLOATS, seatFrame, seatOn } from '../../shared/anim/seat.ts';
import { Solved, solve } from '../../shared/anim/skeleton.ts';
import { quatRotate } from '../../shared/math/quat.ts';
import { parsePack } from '../../shared/pack/pack.ts';
import { Body, BTN_JUMP, BTN_SPRINT, MODE_FLYER, MODE_SWIM, stepBody } from '../../shared/sim/character.ts';
import { groundUnder } from '../../shared/world/collide.ts';
import { GroundMountFrame, groundMountFrame } from '../../shared/world/ground-mount.ts';
import { flatWorld } from '../fixtures/world.ts';
import { strider } from '../fixtures/strider.ts';

function plane(degrees: number, across = false) {
  const w = flatWorld(4), slope = Math.tan(degrees * Math.PI / 180);
  for (let j = 0; j < w.hf.nz; j++) for (let i = 0; i < w.hf.nx; i++) {
    w.hf.setSample(i, j, 20 + ((across ? i : j) * w.hf.cell - 128) * slope);
  }
  return w;
}
function body(w: ReturnType<typeof plane>, kind: string, yaw = 0) {
  const p = w.reg.tamedMove[w.kind(kind)]!, b = new Body();
  b.x = b.z = 128; b.y = groundUnder(w.hf, b.x, b.z, p.radius); b.yaw = yaw; b.grounded = true;
  b.staminaMax = 10000; b.stamina = 10000000;
  return { b, p };
}

test('ground mounts keep authored surface speed uphill, downhill and across 20–50 degree terrain', () => {
  for (const kind of ['core:raptor', 'core:parasaur']) for (const degrees of [20, 40, 50]) for (const yaw of [0, 16384, 32768]) {
    const w = plane(degrees), { b, p } = body(w, kind, yaw);
    let distance = 0;
    for (let tick = 0; tick < 90; tick++) {
      const { x, y, z } = b;
      stepBody(w, b, 0, 127, yaw, 0, BTN_SPRINT, p, 1 / 30);
      const travel = Math.hypot(b.x - x, b.y - y, b.z - z);
      if (tick > 15) { expect(travel * 30).toBeLessThan(p.walkSpeed * p.sprintMul + .03); distance += travel; }
      expect(b.grounded).toBe(true); expect(b.y - groundUnder(w.hf, b.x, b.z, p.radius)).toBeLessThan(.03);
    }
    expect(distance).toBeGreaterThan(p.walkSpeed * p.sprintMul * 2.3);
  }
});

test('support tilt follows the real elevated floor, excludes roofs and does not bridge missing footing', () => {
  const w = plane(30), { p } = body(w, 'core:parasaur'), frame = new GroundMountFrame();
  // A level deck well above sloping terrain must remain level.
  w.structs.add(w.kind('core:ceiling'), 128, 30, 128, 0, 0, 1);
  groundMountFrame(w, p, 128, 30.1, 128, .7, frame);
  expect(frame.supported).toBe(true); expect(frame.ny).toBe(1); expect(Math.abs(frame.lift)).toBeLessThan(.02);
  const under = groundUnder(w.hf, 128, 128, p.radius);
  groundMountFrame(w, p, 128, under, 128, .7, frame);
  expect(frame.supported).toBe(true); expect(frame.ny).toBeCloseTo(Math.cos(Math.PI / 6), 3);
  // Above a gap, no ray beneath the origin reaches a floor in the current footing band.
  groundMountFrame(w, p, 132, 30.1, 128, .7, frame);
  expect(frame.supported).toBe(false); expect([...frame.rotation]).toEqual([0, 0, 0, 1]);
});

test('a crest changes the finite-footprint tilt continuously while a turn leaves the world up unchanged', () => {
  const w = plane(0), { p } = body(w, 'core:raptor'), a = new GroundMountFrame(), b = new GroundMountFrame(), up = new Float64Array(3);
  for (let j = 0; j < w.hf.nz; j++) for (let i = 0; i < w.hf.nx; i++) w.hf.setSample(i, j, 20 - Math.abs(j * w.hf.cell - 128) * .7);
  let prior = 0, maxStep = 0;
  for (let z = 126; z <= 130; z += .025) {
    const y = groundUnder(w.hf, 128, z, p.radius);
    groundMountFrame(w, p, 128, y, z, 0, a);
    const pitch = Math.atan2(a.nz, a.ny);
    if (z > 126) maxStep = Math.max(maxStep, Math.abs(pitch - prior)); prior = pitch;
    groundMountFrame(w, p, 128, y, z, Math.PI / 2, b);
    quatRotate(b.rotation, 0, 0, 1, 0, up, 0);
    expect(up[1]).toBeCloseTo(a.ny, 4);
  }
  expect(maxStep).toBeLessThan(.06);
});

test('actual raptor and parasaur saddle frames match the tilted bones, without changing their appearance or reusing tilt', () => {
  for (const species of ['raptor', 'parasaur']) {
    const w = plane(30, true), { b, p } = body(w, `core:${species}`), st = new AnimState();
    const pack = parsePack(new Uint8Array(readFileSync(new URL(`../fixtures/art/${species}.snpk`, import.meta.url))));
    const rig = buildRigs(pack.header.rigs, pack.clips).get(`core:${species}`)!, anim = new CreatureAnim(rig, 4, 0);
    const seat = w.reg.saddleSeats[w.kind(`core:saddle_${species}`)]![0]!, direct = new Float64Array(SEAT_FLOATS), expected = new Float64Array(SEAT_FLOATS);
    creaturePose(anim, st, 20, rig.a); solve(rig, rig.a, rig.solved);
    const unaligned = new Solved(rig.bones); unaligned.pos.set(rig.solved.pos); unaligned.rot.set(rig.solved.rot);
    groundMountPose(rig.solved, st, w, p, b.x, b.y, b.z, 0);
    seatFrame(rig.solved, rig.sockets.get('seat')!, b.x, b.y, b.z, 0, expected);
    seatOn(anim, seat, st, 20, b.x, b.y, b.z, 0, direct, w, p);
    expect([...direct]).toEqual([...expected]); expect(direct[7]!).toBeLessThan(.95);
    seatOn(anim, seat, st, 20, b.x, b.y, b.z, 0, direct, w, p);
    expect([...direct]).toEqual([...expected]);
    // A rigid whole-body frame preserves bone spacing and all authored limb proportions.
    for (let bone = 1; bone < rig.bones; bone++) {
      const at = bone * 3, parent = rig.parent[bone]! * 3;
      const length = (s: Solved) => Math.hypot(s.pos[at]! - s.pos[parent]!, s.pos[at + 1]! - s.pos[parent + 1]!, s.pos[at + 2]! - s.pos[parent + 2]!);
      expect(length(rig.solved)).toBeCloseTo(length(unaligned), 5);
    }
    for (const mode of [MODE_SWIM, MODE_FLYER]) {
      st.mode = mode; rig.solved.pos.set(unaligned.pos); rig.solved.rot.set(unaligned.rot);
      groundMountPose(rig.solved, st, w, p, b.x, b.y, b.z, 0);
      expect([...rig.solved.pos]).toEqual([...unaligned.pos]); expect([...rig.solved.rot]).toEqual([...unaligned.rot]);
    }
  }
});

test('a ground mount still jumps off a slope and does not tilt its airborne pose', () => {
  const w = plane(30), { b, p } = body(w, 'core:raptor');
  stepBody(w, b, 0, 127, 0, 0, BTN_JUMP, p, 1 / 30);
  expect(b.grounded).toBe(false); expect(b.vy).toBeGreaterThan(4);
  const solved = new Solved(1), st = new AnimState(); solved.pos.set([0, 2, 1]); solved.rot.set([0, 0, 0, 1]); st.grounded = false;
  groundMountPose(solved, st, w, p, b.x, b.y, b.z, 0);
  expect([...solved.pos]).toEqual([0, 2, 1]); expect([...solved.rot]).toEqual([0, 0, 0, 1]);
});

test('the stride phase counts supported surface distance with the same cadence as level travel', () => {
  for (const degrees of [20, 50]) {
    const w = plane(degrees), { p } = body(w, 'core:raptor'), frame = new GroundMountFrame();
    const st = new AnimState(), level = new AnimState(), slopeGait = new Gait(), levelGait = new Gait(), anim = new CreatureAnim(strider(), 4, 0);
    st.speed = 4; let z = 128, flatZ = 128;
    for (let sample = 0; sample < 120; sample++) {
      const y = groundUnder(w.hf, 128, z, p.radius);
      groundMountMotion(st, w, p, 128, y, z, 0, frame);
      level.speed = st.speed * st.surfaceSpeed;
      advanceCreature(anim, slopeGait, st, sample / 2, 128, z, 0, 1);
      advanceCreature(anim, levelGait, level, sample / 2, 128, flatZ, 0, 1);
      expect(slopeGait.phase).toBeCloseTo(levelGait.phase, 3);
      z += .03; flatZ += .03 * st.surfaceSpeed;
    }
    expect(st.surfaceSpeed).toBeCloseTo(1 / Math.cos(degrees * Math.PI / 180), 2);
    // The derived scale neither alters the packed animation contract nor survives an unrelated unpack.
    const packed = st.pack(); st.unpack(packed); expect(st.surfaceSpeed).toBe(1);
  }
});
