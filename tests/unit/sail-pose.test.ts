import { expect, test } from "bun:test";
import layout from "../../content/landmarks/koru-sails.json" with { type: "json" };
import { sailPose, sailPoseBounds, sailWorldPose } from "../../client/core/render/sails.ts";
import { koruPoint } from "../../content/landmarks/koru.ts";
import type { SailVisual } from "../../shared/sim/sail-rig.ts";

const sails = layout.sails as unknown as readonly SailVisual[];
const point = (pose: Float32Array, bone: number, p: readonly number[]): number[] => {
  const at = bone * 12;
  return [0, 1, 2].map(a => pose[at + a * 4]! * p[0]! + pose[at + a * 4 + 1]! * p[1]! + pose[at + a * 4 + 2]! * p[2]! + pose[at + a * 4 + 3]!);
};
const separation = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));

test("authored rigid folds retain shared hinges, fixed jib luffs and exact raised rest pose", () => {
  let seamError = 0, rigidityError = 0, luffError = 0;
  for (const sail of sails) {
    const pose = new Float32Array(sail.bones.length * 12);
    for (const progress of [0, .125, .25, .5, .75, .999, 1]) {
      sailPose(pose, sail, progress);
      for (let i = 1; i < sail.bands.length; i++) {
        const lower = sail.bands[i - 1]!, upper = sail.bands[i]!;
        for (const along of [0, 5, 12]) {
          const vertex = sail.bandAxis === "y" ? [0, upper.lower, along] : [0, along, upper.lower];
          seamError = Math.max(seamError, separation(point(pose, lower.index, vertex), point(pose, upper.index, vertex)));
        }
      }
      for (let bone = 0; bone < sail.bones.length; bone++) if (sail.bones[bone] !== sail.gaff?.bone) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        const offset = bone * 12, dot = [0, 1, 2].reduce((sum, c) => sum + pose[offset + a * 4 + c]! * pose[offset + b * 4 + c]!, 0);
        rigidityError = Math.max(rigidityError, Math.abs(dot - (a === b ? 1 : 0)));
      }
      if (sail.bandAxis === "z") for (const y of [0, 20, 40]) luffError = Math.max(luffError, separation(point(pose, sail.bands[0]!.index, [0, y, 0]), [0, y, 0]));
      if (progress === 1) for (let bone = 0; bone < sail.bones.length; bone++) expect([...pose.subarray(bone * 12, bone * 12 + 12)]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    }
  }
  expect(seamError).toBeLessThan(.00001); expect(rigidityError).toBeLessThan(.000001); expect(luffError).toBe(0);
});

test("retracting gaffs retain uniform normal-safe scale and align with the folded cloth head", () => {
  let chordError = 0, uniformError = 0, height = 0;
  for (const sail of sails.filter(sail => sail.gaff)) {
    const pose = new Float32Array(sail.bones.length * 12), gaff = sail.gaff!;
    for (let i = 0; i <= 100; i++) {
      sailPose(pose, sail, i / 100);
      const bone = sail.bones.indexOf(gaff.bone), throat = point(pose, bone, gaff.throat), peak = point(pose, bone, gaff.peak);
      chordError = Math.max(chordError, Math.abs((peak[2]! - throat[2]!) - (gaff.peak[2] - gaff.throat[2])));
      const offset = bone * 12, scaleSquared = pose[offset]! * pose[offset]!;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        const dot = [0, 1, 2].reduce((sum, c) => sum + pose[offset + a * 4 + c]! * pose[offset + b * 4 + c]!, 0);
        uniformError = Math.max(uniformError, Math.abs(dot - (a === b ? scaleSquared : 0)));
      }
      expect(scaleSquared).toBeGreaterThan(.2); expect(scaleSquared).toBeLessThanOrEqual(1);
      if (i === 0) {
        height = Math.max(height, peak[1]!, throat[1]!);
        for (const band of sail.bands) height = Math.max(height, point(pose, band.index, [0, band.upper, 0])[1]!);
      }
    }
  }
  expect(chordError).toBeLessThan(.00001); expect(uniformError).toBeLessThan(.000001); expect(height).toBeLessThan(.6);
});

test("sail camera-relative poses share the native arbitrary-yaw placement frame and weighted bounds", () => {
  const sail = sails[0]!, pose = new Float32Array(sail.bones.length * 12), camera = { x: 1080, y: 11, z: 1000 };
  for (const yaw of [0, 8191, 16384, 43210]) {
    const state = { x: 1024, y: 0, z: 1024, yaw };
    sailPose(pose, sail, 1); sailWorldPose(pose, sail, state, camera);
    const expected = koruPoint(state.x, state.y, state.z, yaw, sail.anchor);
    expect(separation(point(pose, 0, [0, 0, 0]), [expected[0] - camera.x, expected[1] - camera.y, expected[2] - camera.z])).toBeLessThan(.00001);
  }
  const bounded = { ...sail, boneBounds: sail.bones.map(() => [-.1, 0, 0, .1, 1, 2] as const) }, box = new Float64Array(6);
  sailPose(pose, bounded, .5); sailWorldPose(pose, bounded, { x: 1024, y: 0, z: 1024, yaw: 16384 }, camera);
  expect(sailPoseBounds(box, bounded, pose)).toBe(true);
  // A weighted point is a convex combination of transformed points from its contributing bones.
  const a = point(pose, 1, [0, .5, 1]), b = point(pose, 2, [0, .5, 1]);
  for (let axis = 0; axis < 3; axis++) {
    const blended = a[axis]! * .3 + b[axis]! * .7;
    expect(blended).toBeGreaterThanOrEqual(box[axis]!); expect(blended).toBeLessThanOrEqual(box[axis + 3]!);
  }
});
