// The frame's finish (client/core/render/post.ts): which frames are drawn as light, what the finishing pass is told, and
// the rasterizer's twin of the grade.

import { expect, test } from "bun:test";
import { TIERS, forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { ladder } from "../../client/core/governor.ts";
import { tierWithout } from "../../client/core/passes.ts";
import { FRAME, FramePacket } from "../../client/core/render/packet.ts";
import { BLOOM, SHARPEN, bloomLevels, drawsLight, gradeAt, postFrame } from "../../client/core/render/post.ts";
import { PROGRAMS } from "../../client/core/render/programs.ts";
import { skyFrame, sunHeight, theSky } from "../../client/core/render/sky.ts";
import { shown } from "../../client/core/render/surface.ts";
import { GRADE } from "../../content/grade.ts";

/** The programs that show light, which a frame drawn as light draws with its light untoned. */
const SHOWING = ["flat", "terrain", "terrainWindow", "seeThrough", "far", "pulled", "surface", "surfaceWhole", "surfaceUndyed", "surfaceUndyedWhole", "surfaceLayer", "sky", "water", "details"];

test("high and ultra draw as light where the device has a light target, with the same texts down the governor's steps; medium and low poly draw as they did", () => {
  for (const tier of TIERS) {
    expect([drawsLight(tier, 0x881a), drawsLight(tier, 0)]).toEqual([tier.name === "high" || tier.name === "ultra", false]);
    for (const name of SHOWING) {
      const [as, without] = [PROGRAMS[name]!(tier, "bc", false, true), PROGRAMS[name]!(tier, "bc", false, false)];
      // Only the define differs, and only where the frame is drawn as light.
      expect([as.vertex, as.fragment, as.samplers]).toEqual([without.vertex, without.fragment, without.samplers]);
      expect(as.defines).toBe(without.defines + (drawsLight(tier, true) ? "#define LIGHT_TARGET\n" : ""));
      if (!drawsLight(tier, true)) continue;
      for (const touch of [false, true]) {
        const top = forTouch(tier, touch);
        const steps = [...ladder(top, 1).map((l) => l.tier), tierWithout(top, new Set(["bloom" as const]))];
        for (const t of steps) expect(PROGRAMS[name]!(t, "bc", false, true)).toEqual(PROGRAMS[name]!(top, "bc", false, true));
      }
    }
  }
  // A tier with its light target turned off for a before and after draws as medium does.
  expect(drawsLight(tierWithout(tierOf("high"), new Set(["light" as const])), true)).toBe(false);
});

test("bloom's levels run down to a level no fewer than 16 pixels tall, eight at most, and the governor keeps the narrowest", () => {
  expect([720, 1080, 1440, 2160, 2880, 100000].map((h) => bloomLevels(h, 1))).toEqual([5, 6, 6, 7, 7, 8]);
  expect([bloomLevels(1080, 0.5), bloomLevels(1080, 0), bloomLevels(10, 1)]).toEqual([3, 0, 1]);
});

test("the grade is content's keys, blended by the sun's height, filled in on a tier with a light target and nowhere else", () => {
  for (let k = 1; k < GRADE.length; k++) expect(GRADE[k]!.sun).toBeGreaterThan(GRADE[k - 1]!.sun);
  expect(gradeAt(GRADE[2]!.sun)).toEqual({ ...GRADE[2]! });
  expect([gradeAt(-90), gradeAt(90)]).toEqual([GRADE[0]!, GRADE.at(-1)!]);
  const [a, b] = [GRADE[3]!, GRADE[4]!];
  const mid = gradeAt((a.sun + b.sun) / 2);
  expect(mid.gain[0]).toBeCloseTo((a.gain[0] + b.gain[0]) / 2, 9);
  expect(mid.gamma).toBeCloseTo((a.gamma + b.gamma) / 2, 9);

  const frame = new Float32Array(FRAME.levels + 1).fill(7);
  postFrame(frame, tierOf("medium"), 12, 1080);
  expect([...frame.subarray(FRAME.grade)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  const noon = gradeAt(sunHeight(12));
  postFrame(frame, tierOf("high"), 12, 1080);
  expect([...frame.subarray(FRAME.grade)].map((v) => Math.round(v * 1e4) / 1e4)).toEqual([...noon.gain, noon.saturation, noon.gamma, BLOOM, SHARPEN, 6].map((v) => Math.round(Math.fround(v) * 1e4) / 1e4));
});

test("the rasterizer shows a tier with a light target as medium where its grade is none, and takes the grade where it is one", () => {
  const p = new FramePacket();
  skyFrame(12, theSky(), p.frame);
  const light = [0.2, 0.5, 3];
  const [medium, high] = [[0, 0, 0], [0, 0, 0]];
  p.tier = tierOf("medium");
  shown(medium, light, 10, p);
  p.tier = tierOf("high");
  p.frame.set([1, 1, 1, 1, 1], FRAME.grade);
  shown(high, light, 10, p);
  for (let c = 0; c < 3; c++) expect(high[c]!).toBeCloseTo(medium[c]!, 9);
  // Warmer light, less colour and the dark lifted: red up, blue down, and the grey channel lifted.
  p.frame.set([1.1, 1, 0.9, 0.5, 0.8], FRAME.grade);
  const graded = [0, 0, 0];
  shown(graded, light, 10, p);
  expect([graded[0]! > high[0]!, graded[2]! < high[2]!, graded[1]! > high[1]!]).toEqual([true, true, true]);
});
