import { expect, test } from "bun:test";
import { easeFov, EYE_FROM, EYE_MOST, eyeOff, forcesEye, lookScale, magnification, opticMost, opticZoom, screenPixels, SHAPE_ROUND, SHAPE_TWIN, shapeOf, TWIN_WIDE, windowBox, windowShare, zoomed } from "../../client/core/optics.ts";
import { HudModel } from "../../client/core/hud.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { KEY_SIGHT, KEY_SIGHT_SHADE, buildHud } from "../../client/core/ui/hud.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { S_LENS, S_LENS_TWIN } from "../../client/core/ui/style.ts";
import type { Def, ItemDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CORE_CONTENT } from "../../content/core.ts";

const DEG = Math.PI / 180;

test("a view zoomed so many times magnifies so many times, from any field of view, as far as 2,000 times", () => {
  for (const base of [50 * DEG, 70 * DEG, 100 * DEG]) {
    for (const z of [1, 1.25, 3, 40, 400, 2000]) expect(magnification(base, zoomed(base, z))).toBeCloseTo(z, 6);
  }
  // 400 times from 70 degrees is about a sixth of a degree.
  expect(zoomed(70 * DEG, 400) / DEG).toBeCloseTo(0.2005, 3);
});

test("the look slows on the tangent of the view's half, so a point on screen moves as far under the mouse at any zoom", () => {
  const base = 70 * DEG;
  expect(lookScale(base, base, 1)).toBe(1);
  expect(lookScale(base, base, 2, 1.5)).toBe(2);
  for (const z of [3, 40, 400]) {
    const fov = zoomed(base, z);
    expect(lookScale(base, fov, 1)).toBeCloseTo(1 / z, 9);
    // Angle alone (the old rule) is too fast once narrow: at 40 times about 1/35.
    if (z === 40) expect(fov / base).toBeGreaterThan(1 / 36);
    // The zoom sensitivity weighs the narrowed part: faster above 1, slower under, and never past it.
    expect(lookScale(base, fov, 1, 1.5)).toBeGreaterThan(1 / z);
    expect(lookScale(base, fov, 1, 1.5)).toBeLessThanOrEqual(1.5 / z);
    expect(lookScale(base, fov, 1, 0.5)).toBeLessThan(1 / z);
  }
  // A view opened past the player's own (a vehicle's speed, a glider) turns faster with it.
  expect(lookScale(base, base + 7 * DEG, 1)).toBeGreaterThan(1);
});

test("a view eases on the logarithm of its tangent: a step to forty times takes as long as its first fortieth", () => {
  const base = 70 * DEG;
  expect(easeFov(base, zoomed(base, 4), 1)).toBe(zoomed(base, 4));
  expect(easeFov(base, base, 0.3)).toBe(base);
  // Halfway in the logarithm from 1x to 4x is 2x, and from 4x to 40x is the square root of 160.
  expect(magnification(base, easeFov(base, zoomed(base, 4), 0.5))).toBeCloseTo(2, 9);
  expect(magnification(base, easeFov(zoomed(base, 4), zoomed(base, 40), 0.5))).toBeCloseTo(Math.sqrt(160), 9);
  // It comes to rest on what it wants.
  let fov = base;
  for (let k = 0; k < 200; k++) fov = easeFov(fov, zoomed(base, 400), 0.2);
  expect(magnification(base, fov)).toBeCloseTo(400, 3);
});

test("a sight that magnifies past one and a half times is looked through from the eye", () => {
  expect([forcesEye(0), forcesEye(1), forcesEye(1.25), forcesEye(EYE_FROM), forcesEye(1.51), forcesEye(3)]).toEqual([false, false, false, false, true, true]);
});

test("an optic magnifies from its least to its most, and the content refuses one under 1x, past 2,000x, or out of order", () => {
  expect([opticZoom({ min: 3 }), opticMost({ min: 3 }), opticMost({ min: 4, max: 40 })]).toEqual([3, 3, 40]);
  const scope = CORE_CONTENT.find((d) => d.id === "core:scope" && d.type === "item") as ItemDef;
  expect(scope.optic).toEqual({ min: 3 });
  const errors = (optic: ItemDef["optic"]): string[] => {
    const rest = CORE_CONTENT.filter((d) => d !== scope);
    return compileContent([...rest, { ...scope, optic } as Def]).errors;
  };
  expect(errors({ min: 4, max: 40, steps: [4, 8, 16, 40] })).toEqual([]);
  expect(errors({ min: 0.5 }).join()).toContain("optic must magnify");
  expect(errors({ min: 4, max: 3 }).join()).toContain("optic must magnify");
  expect(errors({ min: 1, max: 4000 }).join()).toContain("optic must magnify");
  expect(errors({ min: 2, max: 30, steps: [2, 8, 4, 30] }).join()).toContain("optic.steps");
  expect(errors({ min: 2, max: 30, steps: [2, 40] }).join()).toContain("optic.steps");
});

test("a window tightens on the logarithm of the zoom from its widest to its tightest, and a fixed sight's spans what it says", () => {
  const glass = { min: 2, max: 32, window: [0.9, 0.4] as const };
  expect(windowShare(glass, 2)).toBeCloseTo(0.9, 9);
  expect(windowShare(glass, 32)).toBeCloseTo(0.4, 9);
  expect(windowShare(glass, 8)).toBeCloseTo(0.65, 9);
  expect([windowShare(glass, 1), windowShare(glass, 99)]).toEqual([0.9, 0.4]);
  expect([windowShare({ min: 3 }, 3), windowShare({ min: 3, window: [0.7, 0.7] }, 3)]).toEqual([1, 0.7]);
  expect([shapeOf(undefined), shapeOf({ min: 2 }), shapeOf({ min: 2, shape: "twin" })]).toEqual([SHAPE_ROUND, SHAPE_ROUND, SHAPE_TWIN]);
  const box = [0, 0, 0, 0];
  windowBox(SHAPE_ROUND, 1, 16 / 9, box);
  expect(box.map((v) => +v.toFixed(6))).toEqual([+(0.5 - 9 / 32).toFixed(6), 0, +(0.5 + 9 / 32).toFixed(6), 1]);
  windowBox(SHAPE_TWIN, 0.5, 16 / 9, box);
  expect((box[2]! - box[0]!) * 16 / 9 / (box[3]! - box[1]!)).toBeCloseTo(TWIN_WIDE, 9);
  // Wider than the screen, it is held to the screen.
  windowBox(SHAPE_TWIN, 1, 1, box);
  expect([box[0], box[2]]).toEqual([0, 1]);
});

test("the eye goes off a scope's axis as the body moves and a shot kicks, the way the sway leads, as far as it may", () => {
  const out = [0, 0];
  eyeOff(0, 0, 1, 0, out);
  expect(out).toEqual([0, 0]);
  eyeOff(1, 0, 3, 4, out);
  expect(out[0]!).toBeCloseTo(0.16 * 0.6, 9);
  expect(out[1]!).toBeCloseTo(0.16 * 0.8, 9);
  eyeOff(9, 9, 0, 0, out);
  expect(out).toEqual([0, EYE_MOST]);
});

test("a sight's window leaves out what lies outside it and magnifies what it draws as the whole view would", () => {
  const whole = new Camera(), part = new Camera();
  for (const c of [whole, part]) {
    c.fovY = zoomed(70 * DEG, 8);
    c.yaw = 0.3;
    c.pitch = -0.05;
  }
  whole.update();
  const before = Float32Array.from(whole.planes);
  part.window.set([-0.25, -0.5, 0.25, 0.5]);
  part.update();
  // The whole view's planes are what they were, bit for bit, and the projection is the same with a window or without.
  whole.update();
  expect(Array.from(whole.planes)).toEqual(Array.from(before));
  expect(Array.from(part.viewProj)).toEqual(Array.from(whole.viewProj));
  expect([whole.windowed, part.windowed]).toEqual([false, true]);
  // Straight ahead 500 m is in both; near the whole view's edge only in the whole.
  const ahead = [0, 0, 0], edge = [0, 0, 0];
  part.ray(0.5, 0.5, ahead);
  part.ray(0.95, 0.5, edge);
  const box = (d: number[]) => [d[0]! * 500 - 1, d[1]! * 500 - 1, d[2]! * 500 - 1, d[0]! * 500 + 1, d[1]! * 500 + 1, d[2]! * 500 + 1] as const;
  expect([whole.boxVisible(...box(ahead)), part.boxVisible(...box(ahead))]).toEqual([true, true]);
  expect([whole.boxVisible(...box(edge)), part.boxVisible(...box(edge))]).toEqual([true, false]);
  // A 4 m creature 2 km off at 8 times fills as many pixels as one 250 m off unmagnified.
  expect(screenPixels(4, 2000, zoomed(70 * DEG, 8), 1080)).toBeCloseTo(screenPixels(4, 250, 70 * DEG, 1080), 9);
});

test("a scope's lens is round and as tall as its window, binoculars' two merged, and the eye off the axis shades it", () => {
  const f = new UiFrame();
  const m = new HudModel();
  m.scope = true;
  m.sightShare = 0.5;
  f.begin(16 / 9);
  buildHud(f, m);
  const lens = f.find(KEY_SIGHT + 4)!;
  expect([lens.style, lens.h, lens.w]).toEqual([S_LENS, f.height / 2, f.height / 2]);
  expect(lens.x + lens.w / 2).toBeCloseTo(f.width / 2, 9);
  // Posts within the lens, and no shadow with the eye on the axis.
  expect(f.find(KEY_SIGHT + 5)!.x).toBeCloseTo(lens.x, 9);
  expect(f.find(KEY_SIGHT_SHADE)).toBeNull();
  m.sightOffX = 0.2;
  m.sightOffY = -0.1;
  f.begin(16 / 9);
  buildHud(f, m);
  const shade = f.find(KEY_SIGHT_SHADE)!;
  expect(shade.x - lens.x).toBeCloseTo(0.2 * lens.h / 2, 9);
  expect(shade.y - lens.y).toBeCloseTo(-0.1 * lens.h / 2, 9);
  expect(f.find(KEY_SIGHT_SHADE + 1)!.w).toBeCloseTo(0.2 * lens.h / 2, 9);
  m.sightShape = SHAPE_TWIN;
  m.sightOffX = m.sightOffY = 0;
  f.begin(16 / 9);
  buildHud(f, m);
  const twin = f.find(KEY_SIGHT + 4)!;
  expect([twin.style, twin.w / twin.h]).toEqual([S_LENS_TWIN, TWIN_WIDE]);
  expect(f.find(KEY_SIGHT + 5)).toBeNull();
});
