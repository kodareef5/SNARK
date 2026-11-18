import { expect, test } from "bun:test";
import { NO_CLIPS, Pose } from "../../shared/anim/clip.ts";
import { B_SPINE, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { createMountMotion, mountPose } from "../../shared/anim/mount.ts";
import { AnimState, HumanAnim, humanPose } from "../../shared/anim/pose.ts";
import { anchorFrame } from "../../shared/anim/seat.ts";
import { quatAxis, quatMul } from "../../shared/math/quat.ts";
import { Solved, rayZones, solve, zoneHit } from "../../shared/anim/skeleton.ts";
import { raySeated } from "../fixtures/seated-ray.ts";

test("sideways saddle passengers have the same turned upper-body hit zones as their drawn pose", () => {
  const anim = new HumanAnim(NO_CLIPS), st = new AnimState(), pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES);
  const frame = new Float64Array(12), motion = createMountMotion(), q = new Float64Array(4);
  let changed = 0, hits = 0;
  for (const facing of [0, .7, -3]) for (const turn of [-1.8, -.8, .8, 1.8]) {
    anchorFrame([0, 2, 0], 0, 0, 0, facing, frame);
    humanPose(anim, st, 0, pose);
    mountPose(motion, { role: "ride", tick: 0, startTick: 0, durationTicks: 1, upper: pose }, pose);
    quatAxis(q, 0, 0, 1, 0, Math.max(-1.2, Math.min(1.2, turn)));
    quatMul(pose.rot, B_SPINE * 4, q, 0, pose.rot, B_SPINE * 4);
    solve(HUMAN, pose, solved);
    for (const x of [-.4, -.2, 0, .2, .4]) for (const y of [.5, .8, 1.1, 1.4]) {
      const expected = rayZones(HUMAN, solved, x, y, -3, 0, 0, 1, 6), distance = zoneHit.t;
      const ox = frame[0]! + frame[3]! * x + frame[4]! * y - frame[5]! * 3;
      const oy = frame[1]! + frame[6]! * x + frame[7]! * y - frame[8]! * 3;
      const oz = frame[2]! + frame[9]! * x + frame[10]! * y - frame[11]! * 3;
      const got = raySeated(anim, st, 0, frame, false, ox, oy, oz, frame[5]!, frame[8]!, frame[11]!, 6, 0, null, facing + turn);
      expect(got).toBe(expected);
      expect(zoneHit.t).toBeCloseTo(distance, 4);
      if (got) hits++;
      const straight = raySeated(anim, st, 0, frame, false, ox, oy, oz, frame[5]!, frame[8]!, frame[11]!, 6);
      if (straight !== got || Math.abs(zoneHit.t - distance) > .01) changed++;
    }
  }
  expect(hits).toBeGreaterThan(30);
  expect(changed).toBeGreaterThan(30);
});
