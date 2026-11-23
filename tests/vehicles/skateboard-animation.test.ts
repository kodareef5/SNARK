import { expect, test } from "bun:test";
import { Pose } from "../../shared/anim/clip.ts";
import { B_FINGERTIPS_L, B_FINGERTIPS_R, B_FOOT_L, B_FOOT_R, B_HIPS, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { createMountMotion, mountOrigin, mountPose } from "../../shared/anim/mount.ts";
import { skateDeckRotation } from "../../shared/anim/skate.ts";
import { solve, Solved } from "../../shared/anim/skeleton.ts";
import { TAU } from "../../shared/math/scalar.ts";
import { FLIP, GRAB, PUSH, ROLL } from "../../shared/sim/skate-state.ts";
import { T_HEELFLIP, T_INDY, T_KICKFLIP, T_MELON } from "../../shared/sim/skate-tricks.ts";

const motion = createMountMotion();
function joints(move: number, phase: number, switched = false, trick = 0, crouch = 0) {
  const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES);
  mountPose(motion, { role: "skate", tick: 0, startTick: 0, durationTicks: 1, skateMove: move, skateTrick: trick, skatePhase: phase*TAU, switched, crouch }, pose);
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

test("a melon reaches the heel edge with the front hand, an indy the toe edge with the back hand", () => {
  const origin = new Float64Array(3), ride = joints(ROLL, 0);
  const melon = joints(GRAB, .99, false, T_MELON), indy = joints(GRAB, .99, false, T_INDY);
  mountOrigin(melon, [0, .935, 0], [0, 0, 0, 1], origin, HUMAN.rest);
  expect(melon.pos[B_FINGERTIPS_L*3]! + origin[0]!).toBeCloseTo(.10, 1);
  expect(melon.pos[B_FINGERTIPS_L*3+1]! + origin[1]!).toBeCloseTo(.12, 1);
  expect(melon.pos[B_HIPS*3+1]!).toBeLessThan(ride.pos[B_HIPS*3+1]! - .4);
  mountOrigin(indy, [0, .935, 0], [0, 0, 0, 1], origin, HUMAN.rest);
  expect(indy.pos[B_FINGERTIPS_R*3]! + origin[0]!).toBeLessThan(0);
  // Let go, the rider is back in the riding stance.
  expect(joints(GRAB, 0, false, T_MELON).pos).toEqual(ride.pos);
});

test("a kickflip turns the deck about its length one way and a heelflip the other", () => {
  const kick = new Float64Array(4), heel = new Float64Array(4);
  skateDeckRotation(FLIP, T_KICKFLIP, .25*TAU, kick);
  skateDeckRotation(FLIP, T_HEELFLIP, .25*TAU, heel);
  expect(kick[2]).toBeCloseTo(Math.sin(Math.PI/4), 5);
  expect(heel[2]).toBeCloseTo(-Math.sin(Math.PI/4), 5);
  // A wrapped observer phase gives the same turn.
  const wrapped = new Float64Array(4);
  skateDeckRotation(FLIP, T_KICKFLIP, -.75*TAU, wrapped);
  for (let i = 0; i < 4; i++) expect(wrapped[i]).toBeCloseTo(kick[i]!, 5);
});

test("a held pop crouches the rider and riding switch plants the opposite foot", () => {
  const ride = joints(ROLL, 0), crouched = joints(ROLL, 0, false, 0, 1);
  expect(crouched.pos[B_HIPS*3+1]!).toBeLessThan(ride.pos[B_HIPS*3+1]! - .15);
  const switchRide = joints(ROLL, 0, true), push = joints(PUSH, .625, true);
  for (let axis = 0; axis < 3; axis++) {
    expect(push.pos[B_FOOT_R*3+axis]).toBeCloseTo(switchRide.pos[B_FOOT_R*3+axis]!, 4);
  }
  expect(push.pos[B_FOOT_L*3]!).toBeGreaterThan(switchRide.pos[B_FOOT_L*3]! + .17);
  expect(push.pos[B_FOOT_L*3+2]!).toBeGreaterThan(switchRide.pos[B_FOOT_L*3+2]! + .08);
});
