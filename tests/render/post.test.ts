// The frame's finish (client/core/render/post.ts): which frames are drawn as light, what the finishing pass is told, and
// the rasterizer's twin of the grade.

import { expect, test } from "bun:test";
import { TIERS, forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { ladder } from "../../client/core/governor.ts";
import { tierWithout } from "../../client/core/passes.ts";
import { CONTACT_MOST, contactFrame, contactShare } from "../../client/core/render/contact.ts";
import { FRAME, FRAME_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CUE_DEAD } from "../../shared/anim/pose.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { BLOOM, RESOLUTIONS, SHARPEN, bloomLevels, drawsLight, gradeAt, levelShift, lightBytes, lightSamples, passExtent, postFrame, sceneShare, sceneSize, sharpenAt, tapShift } from "../../client/core/render/post.ts";
import { provingView } from "../../tools/snap.ts";
import { PROGRAMS } from "../../client/core/render/programs.ts";
import { skyFrame, sunHeight, theSky } from "../../client/core/render/sky.ts";
import { graded, shown, skyShown, tone, ungraded, untone } from "../../client/core/render/surface.ts";
import { GRADE } from "../../content/grade.ts";

/** The programs that show light, which a frame drawn as light draws with its light untoned. */
const SHOWING = ["flat", "terrain", "terrainWindow", "seeThrough", "far", "pulled", "surface", "surfaceWhole", "surfaceUndyed", "surfaceUndyedWhole", "surfaceLayer", "sky", "water", "details", "screens"];

test("light-target variants keep the same shaders down the governor's ladder", () => {
  for (const tier of TIERS) {
    expect([drawsLight(tier, 0x881a), drawsLight(tier, 0)]).toEqual([tier.name === "high" || tier.name === "ultra", false]);
    for (const name of SHOWING) {
      const [as, without] = [PROGRAMS[name]!(tier, "bc", false, true), PROGRAMS[name]!(tier, "bc", false, false)];
      // Only the define differs, and only where the frame is drawn as light.
      expect([as.vertex, as.fragment, as.samplers]).toEqual([without.vertex, without.fragment, without.samplers]);
      const lightDefines = /^#define LIGHT_TARGET\n/gm;
      expect([...as.defines.matchAll(lightDefines)].length).toBe(Number(drawsLight(tier, true)));
      expect(as.defines.replace(lightDefines, "")).toBe(without.defines);
      if (!drawsLight(tier, true)) continue;
      for (const touch of [false, true]) {
        const top = forTouch(tier, touch);
        const steps = [...ladder(top, 1).map((l) => l.tier), tierWithout(top, new Set(["bloom" as const]))];
        for (const t of steps) expect(PROGRAMS[name]!(t, "bc", false, true)).toEqual(PROGRAMS[name]!(top, "bc", false, t.post !== null));
      }
    }
  }
  // A tier with its light target turned off for a before and after draws as medium does.
  expect(drawsLight(tierWithout(tierOf("high"), new Set(["light" as const])), true)).toBe(false);
});

test("bloom's levels run from a quarter of the canvas down to a level no fewer than 16 pixels tall; the target takes no samples on a supersampled canvas, and its bytes", () => {
  expect([720, 1080, 1440, 2160, 2880, 100000].map((h) => bloomLevels(h, 1))).toEqual([4, 5, 5, 6, 6, 7]);
  expect([bloomLevels(1080, 0), bloomLevels(10, 1)]).toEqual([0, 1]);
  // The scene, then each level two halvings and more down; the first level's taps at a half-size picture's texels, the finish's at the scene's.
  expect([0, 1, 2, 5].map(levelShift)).toEqual([0, 2, 3, 6]);
  expect([tapShift(0, 1), tapShift(1, 2), tapShift(2, 1), tapShift(0, -1)]).toEqual([1, 2, 3, 0]);
  expect([lightSamples(false), lightSamples(true)]).toEqual([2, 0]);
  expect([lightBytes(2560, 1440, 2), lightBytes(2560, 1440, 4), lightBytes(3840, 1986, 0)].map((b) => Math.round(b / 1e6))).toEqual([119, 207, 94]);
});

test("the scene's share: high's a laptop's 3,600 by 1,924 at 85% a side and 1,600p and under whole, ultra whole, the player's choice where made, and a tier with no light target always whole", () => {
  const [high, ultra, medium] = [tierOf("high"), tierOf("ultra"), tierOf("medium")];
  const px = (w: number, h: number): number => w * h;
  expect([[3600, 1924], [3456, 2234], [3840, 2160], [3024, 1964], [2560, 1600], [2560, 1440], [1920, 1080], [1280, 720]].map(([w, h]) => sceneShare(high, 0, px(w!, h!)))).toEqual([0.85, 0.8, 0.75, 0.9, 1, 1, 1, 1]);
  // Never under a half, however large the canvas.
  expect(sceneShare(high, 0, px(15360, 8640))).toBe(0.5);
  expect([sceneShare(ultra, 0, px(3600, 1924)), sceneShare(ultra, 0, px(7680, 4320))]).toEqual([1, 1]);
  // The player's choice is taken as it is, on high and ultra, and a canvas small or large.
  expect(RESOLUTIONS.map((r) => r.label)).toEqual(["auto", "native", "75%", "50%"]);
  for (const t of [high, ultra]) expect(RESOLUTIONS.map((r) => sceneShare(t, r.share, px(1920, 1080)))).toEqual([1, 1, 0.75, 0.5]);
  expect(RESOLUTIONS.map((r) => sceneShare(high, r.share, px(3600, 1924)))).toEqual([0.85, 1, 0.75, 0.5]);
  // Medium, low poly, a phone's tiers and a tier with its light target turned off draw the canvas's own.
  for (const t of [medium, tierOf("lowpoly"), forTouch(high, true), tierWithout(high, new Set(["light" as const]))]) for (const r of RESOLUTIONS) expect(sceneShare(t, r.share, px(3600, 1924))).toBe(1);
});

test("the scene drawn at a share fills the corner of a target made for its share before the governor's steps, and each pass reads only that corner, its far edges held half a texel in", () => {
  expect([sceneSize(3600, 1924, 1), sceneSize(3600, 1924, 0.75), sceneSize(3600, 1924, 0.75 * 0.9), sceneSize(3, 2, 0.1)]).toEqual([[3600, 1924], [2700, 1443], [2430, 1299], [1, 1]]);
  const near = (a: Float32Array): number[] => [...a].map((v) => Math.round(v * 1e6) / 1e6);
  // At the canvas's own pixels a read is held where the texture's own edge holds it: nothing moves.
  expect(near(passExtent(1920, 1080, 1920, 1080, 0, 1))).toEqual(near(Float32Array.of(1, 1, 1 - 0.5 / 1920, 1 - 0.5 / 1080)));
  expect(near(passExtent(1920, 1080, 1920, 1080, 0, -1))).toEqual(near(Float32Array.of(1, 1, 1 - 0.5 / 480, 1 - 0.5 / 270)));
  // The governor's step to 90% of three quarters: the scene 2,430 by 1,299 in a target of 2,700 by 1,443, bloom's first
  // level 607 by 324 of 675 by 360, its second 303 by 162 of 337 by 180.
  expect(near(passExtent(2430, 1299, 2700, 1443, 0, 1))).toEqual(near(Float32Array.of(2430 / 2700, 1299 / 1443, 2429.5 / 2700, 1298.5 / 1443)));
  expect(near(passExtent(2430, 1299, 2700, 1443, 1, 2))).toEqual(near(Float32Array.of(607 / 675, 324 / 360, 606.5 / 675, 323.5 / 360)));
  expect(near(passExtent(2430, 1299, 2700, 1443, 2, 1))).toEqual(near(Float32Array.of(303 / 337, 162 / 180, 302.5 / 337, 161.5 / 180)));
  // The finish reads the scene's corner, and bloom's first level held within its own.
  expect(near(passExtent(2430, 1299, 2700, 1443, 0, -1))).toEqual(near(Float32Array.of(2430 / 2700, 1299 / 1443, 606.5 / 675, 323.5 / 360)));
  // The sharpen is the canvas's own at its own pixels, and more for a scene taken up, to 0.55 at three quarters and under.
  expect([1, 0.9, 0.85, 0.75, 0.5].map((s) => Math.round(sharpenAt(s) * 100) / 100)).toEqual([SHARPEN, 0.37, 0.43, 0.55, 0.55]);
});

test("a frame on high at a laptop's canvas is drawn at its share, the governor's steps less of the same target, which the card's ledger counts at its share; medium's at the canvas's own", () => {
  const view = provingView(640, 360);
  const s = view.scene;
  [s.canvasWidth, s.canvasHeight, s.share] = [3600, 1924, sceneShare(tierOf("high"), 0, 3600 * 1924)];
  // Past the screens' steps, which come first.
  const levels = ladder(tierOf("high"), 2).filter((l) => !l.screens);
  for (const [tier, room, share] of [[tierOf("high"), 0.85, 0.85], [levels[1]!.tier, 0.85, 0.765], [levels[3]!.tier, 0.85, 0.595], [tierOf("medium"), 1, 1]] as const) {
    s.assets.tier = tier;
    const p = s.build(view.cam, view.remote);
    expect([p.room, Math.round(p.share * 1000) / 1000]).toEqual([room, share]);
    expect(s.assets.residency["reserves"].get("light target") ?? 0).toBe(tier.post ? lightBytes(3060, 1635, 2) : 0);
    // Bloom's levels are counted from the target's height, and the sharpen from the scene's share.
    if (tier.post) expect([p.frame[FRAME.levels], p.frame[FRAME.sharpen]]).toEqual([bloomLevels(1635, 1), Math.fround(sharpenAt(p.share))]);
  }
});

test("the grade is content's keys, blended by the sun's height, filled in on every lit tier, and bloom and the sharpen on a tier with a light target alone", () => {
  for (let k = 1; k < GRADE.length; k++) expect(GRADE[k]!.sun).toBeGreaterThan(GRADE[k - 1]!.sun);
  expect(gradeAt(GRADE[2]!.sun)).toEqual({ ...GRADE[2]! });
  expect([gradeAt(-90), gradeAt(90)]).toEqual([GRADE[0]!, GRADE.at(-1)!]);
  const [a, b] = [GRADE[3]!, GRADE[4]!];
  const mid = gradeAt((a.sun + b.sun) / 2);
  expect(mid.gain[0]).toBeCloseTo((a.gain[0] + b.gain[0]) / 2, 9);
  expect(mid.gamma).toBeCloseTo((a.gamma + b.gamma) / 2, 9);

  const frame = new Float32Array(FRAME.levels + 1).fill(7);
  const noon = gradeAt(sunHeight(12));
  const near = (list: number[]): number[] => list.map((v) => Math.round(Math.fround(v) * 1e4) / 1e4);
  postFrame(frame, tierOf("lowpoly"), 12, 1080);
  expect([...frame.subarray(FRAME.grade)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  postFrame(frame, tierOf("medium"), 12, 1080);
  expect(near([...frame.subarray(FRAME.grade)])).toEqual(near([...noon.gain, noon.saturation, noon.gamma, 0, 0, 0]));
  postFrame(frame, tierOf("high"), 12, 1080);
  expect(near([...frame.subarray(FRAME.grade)])).toEqual(near([...noon.gain, noon.saturation, noon.gamma, BLOOM, SHARPEN, 5]));
});

test("the rasterizer shows medium as a tier with a light target out of the fog, both taking the grade, and medium's fog as the sky's colour shown", () => {
  const p = new FramePacket();
  skyFrame(12, theSky(), p.frame);
  const light = [0.2, 0.5, 3];
  const [medium, high, plain] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  // Warmer light, less colour and the dark lifted against no grade at all: red up, blue down, and the grey channel lifted.
  p.frame.set([1, 1, 1, 1, 1], FRAME.grade);
  p.tier = tierOf("high");
  shown(plain, light, 10, p);
  p.frame.set([1.1, 1, 0.9, 0.5, 0.8], FRAME.grade);
  shown(high, light, 10, p);
  p.tier = tierOf("medium");
  shown(medium, light, 10, p);
  for (let c = 0; c < 3; c++) expect(medium[c]!).toBeCloseTo(high[c]!, 9);
  expect([high[0]! > plain[0]!, high[2]! < plain[2]!, high[1]! > plain[1]!]).toEqual([true, true, true]);
  // A colour the grade did not clamp is taken back to what it was.
  const back = [0.1, 0.3, 0.6];
  graded(back, p.frame);
  ungraded(back, p.frame);
  back.forEach((v, c) => expect(v).toBeCloseTo([0.1, 0.3, 0.6][c]!, 9));
  // And light the tone curve took, over its knee or under it.
  for (const light of [[0.2, 0.5, 0.7], [0.4, 1.1, 2.6]]) {
    const t = [0, 0, 0];
    tone(t, light);
    untone(t, t);
    t.forEach((v, c) => expect(v).toBeCloseTo(light[c]!, 9));
  }
  // Under water and far off, medium is the sky's colour as light, graded and shown; with no grade, as it is where the tone curve leaves it.
  p.frame[FRAME.eyeHeight] = -1;
  p.frame.set([1, 1, 1, 1, 1], FRAME.grade);
  [p.fogStart, p.fogEnd, p.sky[0], p.sky[1], p.sky[2]] = [0, 1, 0.2, 0.4, 0.5];
  skyShown(p);
  shown(medium, light, 10, p);
  for (let c = 0; c < 3; c++) expect(medium[c]!).toBeCloseTo(p.sky[c]!, 6);
  // Graded, the fog is the sky's colour taken as light and shown as everything else is, warmer and lifted.
  p.frame.set([1.1, 1, 0.9, 0.5, 0.8], FRAME.grade);
  skyShown(p);
  shown(medium, light, 10, p);
  expect([p.skyShown[0]! > p.sky[0]!, ...[0, 1, 2].map((c) => Math.abs(medium[c]! - p.skyShown[c]!) < 1e-6)]).toEqual([true, true, true, true]);
});

test("contact: the bodies nearest the camera, a vehicle as its driving box, the ground under one taken down and its sides little, on a tier with a light target alone", () => {
  const reg = coreRegistry();
  const [car, survivor] = [reg.index.get("core:compact")!, reg.index.get("core:survivor")!];
  const remote = new RemoteSample();
  const put = (kind: number, x: number, z: number, yaw: number, cue = 0): void => {
    const n = remote.count++;
    [remote.kind[n], remote.x[n], remote.y[n], remote.z[n], remote.yaw[n], remote.cue[n]] = [kind, x, 0, z, yaw, cue];
  };
  put(survivor, 30, 0, 0);
  put(car, 10, 0, Math.PI / 2);
  put(survivor, 4, 4, 0, CUE_DEAD);
  put(survivor, 500, 0, 0);
  const frame = new Float32Array(FRAME_FLOATS);
  const cam = { x: 0, y: 1.7, z: 0 };
  contactFrame(frame, true, reg, remote, null, cam);
  const spec = reg.vehicle[car]!.spec;
  // The car first, nearest, as its box, then the living survivor; the dead and the far are left out, and the list ends.
  expect([...frame.subarray(FRAME.contact + 4, FRAME.contact + 7)].map((v) => Math.round(v * 100) / 100)).toEqual([spec.halfWidth, spec.height / 2, -spec.halfLength].map((v) => Math.round(Math.fround(v) * 100) / 100));
  expect([frame[FRAME.contact]!, frame[FRAME.contact + 8]!, frame[FRAME.contact + 20]!]).toEqual([10, 30, 0]);
  const up = [0, 1, 0];
  const under = contactShare(frame, [10, -1.7, 0], up);
  const beside = contactShare(frame, [10, -1.7, spec.halfWidth + 3], up);
  expect(under).toBeCloseTo((1 - CONTACT_MOST) * 0.16, 3);
  // With only the additional chassis shape disabled, the original ellipsoid still shades the road.
  const old = frame.slice(); old[FRAME.contact+6] = spec.halfLength;
  for (const x of [-0.85,0,0.85]) {
    const sill = [10+x*spec.halfLength, -1.7, spec.halfWidth*1.18];
    expect(contactShare(frame,sill,up)).toBeLessThan(contactShare(old,sill,up)*0.52);
  }
  for (const y of [-3.0,-1.0]) {
    expect(contactShare(frame,[10,y,0],up)).toBeCloseTo(contactShare(old,[10,y,0],up),5);
  }
  expect(beside).toBeGreaterThan(0.9);
  expect(contactShare(frame, [60, -1.7, 0], up)).toBe(1);
  // A face turned from the body takes none.
  expect(contactShare(frame, [10, -1.7, spec.halfWidth + 0.5], [0, 0, 1])).toBe(1);
  // Medium holds none.
  contactFrame(frame, false, reg, remote, null, cam);
  expect(contactShare(frame, [10, -1.7, 0], up)).toBe(1);
});
