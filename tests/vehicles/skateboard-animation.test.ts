import { expect, test } from "bun:test";
import { Pose } from "../../shared/anim/clip.ts";
import { B_FINGERTIPS_L, B_FOOT_L, B_FOOT_R, B_HIPS, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { createMountMotion, mountOrigin, mountPose } from "../../shared/anim/mount.ts";
import { skateDeckRotation } from "../../shared/anim/skate.ts";
import { solve, Solved } from "../../shared/anim/skeleton.ts";
import { TAU } from "../../shared/math/scalar.ts";
import { GRAB, PUSH, ROLL, SPIN } from "../../shared/sim/skate-state.ts";

const motion = createMountMotion();
function joints(move: number, phase: number, switched = false) {
  const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES);
  mountPose(motion, { role: "skate", tick: 0, startTick: 0, durationTicks: 1, skateMove: move, skatePhase: phase*TAU, switched }, pose);
  solve(HUMAN, pose, solved);
  return solved;
}

test("the front foot stays planted while the push foot sweeps the pavement", () => {
  const start = joints(PUSH, 0), reach = joints(PUSH, .25), contact = joints(PUSH, .625), finish = joints(PUSH, .999);
  const front = B_FOOT_L*3, back = B_FOOT_R*3;
  for (const frame of [reach, contact, finish]) {
    for (let axis = 0; axis < 3; axis++) expect(frame.pos[front+axis]).toBeCloseTo(start.pos[front+axis]!, 3);
  }
  expect(contact.pos[back]! - start.pos[back]!).toBeGreaterThan(.17);
  expect(reach.pos[back+2]! - contact.pos[back+2]!).toBeGreaterThan(.34);
  expect(start.pos[back+1]! - contact.pos[back+1]!).toBeGreaterThan(.08);
  expect(finish.pos[back+2]).toBeCloseTo(start.pos[back+2]!, 2);
});

test("the melon grab reaches the heel edge and releases into riding stance", () => {
  const held = joints(GRAB, .99), released = joints(GRAB, 0), ride = joints(ROLL, 0);
  const origin = new Float64Array(3);
  mountOrigin(held, [0, .935, 0], [0, 0, 0, 1], origin, HUMAN.rest);
  const tip = B_FINGERTIPS_L*3;
  expect(held.pos[tip]! + origin[0]!).toBeCloseTo(.10, 1);
  expect(held.pos[tip+1]! + origin[1]!).toBeCloseTo(.12, 1);
  expect(held.pos[B_HIPS*3+1]!).toBeLessThan(ride.pos[B_HIPS*3+1]! - .4);
  expect(released.pos).toEqual(ride.pos);
});

test("a wrapped observer phase keeps the deck and rider turning together", () => {
  const signed = joints(SPIN, -.25), positive = joints(SPIN, .75), regular = joints(ROLL, 0);
  for (let i = 0; i < signed.pos.length; i++) expect(signed.pos[i]).toBeCloseTo(positive.pos[i]!, 5);
  const deck = new Float64Array(4);
  skateDeckRotation(SPIN, -.25*TAU, deck);
  expect(deck[1]).toBeCloseTo(Math.sin(3*Math.PI/8), 5);
  expect(regular.pos[B_FOOT_L*3+2]!).toBeGreaterThan(regular.pos[B_FOOT_R*3+2]!);
  expect(signed.pos[B_FOOT_L*3+2]!).toBeLessThan(signed.pos[B_FOOT_R*3+2]!);
});

test("riding switch plants the opposite foot and kicks along the new direction", () => {
  const ride = joints(ROLL, 0, true), push = joints(PUSH, .625, true);
  for (let axis = 0; axis < 3; axis++) {
    expect(push.pos[B_FOOT_R*3+axis]).toBeCloseTo(ride.pos[B_FOOT_R*3+axis]!, 4);
  }
  expect(push.pos[B_FOOT_L*3]!).toBeGreaterThan(ride.pos[B_FOOT_L*3]! + .17);
  expect(push.pos[B_FOOT_L*3+2]!).toBeGreaterThan(ride.pos[B_FOOT_L*3+2]! + .08);
});
