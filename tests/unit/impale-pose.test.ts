import { expect, test } from "bun:test";
import { NO_CLIPS, Pose } from "../../shared/anim/clip.ts";
import { HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { createMountMotion, mountPose } from "../../shared/anim/mount.ts";
import { AnimState, HumanAnim } from "../../shared/anim/pose.ts";
import { Solved, rayZones, solve, zoneHit } from "../../shared/anim/skeleton.ts";
import { seatFrame, SEAT_DROP } from "../../shared/anim/seat.ts";
import { quatAxis } from "../../shared/math/quat.ts";
import { rayBody } from "../../shared/anim/zones.ts";

test("impaled human hit zones follow the same folded pose as the visible body", () => {
  const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES), motion = createMountMotion();
  const anim = new HumanAnim(NO_CLIPS), state = new AnimState();
  mountPose(motion, { role: "impaled", tick: 0, startTick: 0, durationTicks: 1 }, pose);
  solve(HUMAN, pose, solved);
  let differences = 0, hits = 0;
  for (const x of [-.4, -.2, 0, .2, .4]) for (const y of [.3, .6, .9, 1.2, 1.5]) {
    const expected = rayZones(HUMAN, solved, x, y, -3, 0, 0, 1, 6), distance = zoneHit.t;
    const actual = rayBody(anim, state, 0, 0, 0, 0, 0, x, y, -3, 0, 0, 1, 6, 0, true);
    expect(actual).toBe(expected);
    expect(zoneHit.t).toBeCloseTo(distance, 5);
    if (actual) hits++;
    const ordinary = rayBody(anim, state, 0, 0, 0, 0, 0, x, y, -3, 0, 0, 1, 6);
    if (ordinary !== actual || Math.abs(zoneHit.t - distance) > .01) differences++;
  }
  expect(hits).toBeGreaterThan(6);
  expect(differences).toBeGreaterThan(3);
  for (const value of solved.pos) expect(Number.isFinite(value)).toBe(true);
});


test("a tail attachment uses the exact socket centre without a saddle's pelvis drop", () => {
  const solved = new Solved(1), normal = new Float64Array(12), impaled = new Float64Array(12);
  solved.pos.set([0, 2, 3]); quatAxis(solved.rot, 0, 1, 0, 0, .4);
  const socket = { bone: 0, x: 0, y: 0, z: 0 };
  seatFrame(solved, socket, 10, 20, 30, .7, normal);
  seatFrame(solved, socket, 10, 20, 30, .7, impaled, 0);
  expect(impaled[1]).toBe(22);
  expect(Math.hypot(impaled[0]! - normal[0]!, impaled[1]! - normal[1]!, impaled[2]! - normal[2]!)).toBeCloseTo(SEAT_DROP, 6);
  expect(impaled.subarray(3)).toEqual(normal.subarray(3));
});
