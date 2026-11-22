import { expect, test } from "bun:test";
import { easeFov, EYE_FROM, EYE_MOST, eyeOff, forcesEye, lookScale, magnification, opticMost, opticZoom, screenPixels, SHAPE_ROUND, SHAPE_TWIN, SHAPE_VISOR, shapeOf, TWIN_WIDE, VISOR_WIDE, windowBox, windowShare, zoomed } from "../../client/core/optics.ts";
import { HudModel } from "../../client/core/hud.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { KEY_SIGHT, KEY_SIGHT_SHADE, buildHud } from "../../client/core/ui/hud.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { S_LENS, S_LENS_TWIN } from "../../client/core/ui/style.ts";
import { DIGITAL_GRAIN, NIGHT_GAIN, NIGHT_GRAIN, VISOR_FIRST, VISOR_GLASS, VISOR_STEP, Visor } from "../../client/core/visor.ts";
import { FRAME, FramePacket, HEAT_COLD, HEAT_HOT, HEAT_WARM, HEAT_WORLD, OPTIC_AT, OPTIC_HEAT, OPTIC_NIGHT, OPTIC_NONE } from "../../client/core/render/packet.ts";
import { PHOSPHOR, opticFrame, postFrame, type Optic } from "../../client/core/render/post.ts";
import { graded, heatOfShown, ironbow, shown } from "../../client/core/render/surface.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { KEY_CROSS, KEY_GLASS, KEY_MIL, KEY_SPOT, KEY_VISOR, MARKER_TINT } from "../../client/core/ui/hud.ts";
import { Glass, SHAKE } from "../../client/core/glass.ts";
import { BTN_SECONDARY, BTN_SPRINT, Body, STANCE_CROUCH, STANCE_PRONE, STANCE_STAND } from "../../shared/sim/character.ts";
import { BREATH_STEADY, aimShot, holdsBreath, scopeFitted, shotAim, sway, swayOut, zeroUnits } from "../../shared/sim/aim.ts";
import { Inventory } from "../../shared/sim/items.ts";
import { InputBuffer, readInputs, writeInputs } from "../../shared/net/protocol.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
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

test("a visor zooms in steps of the wheel within its helmet's optic, turns to night vision with N, and amplifies by night and not by day", () => {
  const optic = { min: 2, max: 1000 };
  const v = new Visor();
  expect(v.step(optic, true)).toBe(false);
  v.held = true;
  expect([v.step(optic, false), v.step(null, true), v.step(optic, true)]).toEqual([false, false, true]);
  expect(v.zoom).toBe(VISOR_FIRST);
  v.wheel(optic, -2);
  expect(v.zoom).toBeCloseTo(VISOR_FIRST * VISOR_STEP ** 2, 9);
  for (let k = 0; k < 60; k++) v.wheel(optic, -1);
  expect([v.zoom, v.digital]).toEqual([1000, true]);
  for (let k = 0; k < 60; k++) v.wheel(optic, 1);
  expect([v.zoom, v.digital]).toEqual([2, false]);
  const out: Optic = { mode: 0, gain: 1, grain: 0 };
  v.frame(out, 0);
  expect(out).toEqual({ mode: OPTIC_NONE, gain: 1, grain: 0 });
  v.cycle();
  v.frame(out, 0);
  expect(out).toEqual({ mode: OPTIC_NIGHT, gain: NIGHT_GAIN, grain: NIGHT_GRAIN });
  v.frame(out, 1);
  expect(out.gain).toBe(1);
  // Past its glass the picture grows grainier, to forty times past it.
  v.zoom = VISOR_GLASS * 40;
  v.frame(out, 1);
  expect(out.grain).toBeCloseTo(NIGHT_GRAIN + DIGITAL_GRAIN, 9);
  v.cycle();
  v.held = false;
  v.step(optic, true);
  v.frame(out, 0);
  expect(out).toEqual({ mode: OPTIC_NONE, gain: 1, grain: 0 });
});

test("night vision amplifies the frame's light and shows its grey in the phosphor's colour, on the GPU and in its twin alike; low poly is left as it is", () => {
  const p = new FramePacket();
  const lit = tierOf("medium");
  postFrame(p.frame, lit, 23, 720);
  const gain = [0, 1, 2].map((c) => p.frame[FRAME.grade + c]!);
  opticFrame(p.frame, lit, { mode: OPTIC_NONE, gain: 1, grain: 0 }, 3);
  expect(Array.from(p.frame.subarray(OPTIC_AT, OPTIC_AT + 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  opticFrame(p.frame, lit, { mode: OPTIC_NIGHT, gain: 6, grain: 0.03 }, 3);
  expect([0, 1, 2].map((c) => p.frame[FRAME.grade + c]!)).toEqual(gain.map((g) => Math.fround(g * 6)));
  // Medium has no finish to draw grain in.
  expect(Array.from(p.frame.subarray(OPTIC_AT, OPTIC_AT + 3))).toEqual([OPTIC_NIGHT, 0, 3]);
  expect(Array.from(p.frame.subarray(OPTIC_AT + 4, OPTIC_AT + 7))).toEqual(PHOSPHOR.map(Math.fround));
  const out = [0.3, 0.2, 0.1];
  graded(out, p.frame);
  expect(out[1]! / out[0]!).toBeCloseTo(PHOSPHOR[1]! / PHOSPHOR[0]!, 5);
  expect(out[2]! / out[0]!).toBeCloseTo(PHOSPHOR[2]! / PHOSPHOR[0]!, 5);
  const high = tierOf("high");
  opticFrame(p.frame, high, { mode: OPTIC_NIGHT, gain: 6, grain: 0.03 }, 3);
  expect(p.frame[OPTIC_AT + 1]).toBeCloseTo(0.03, 6);
  const flat = new FramePacket();
  opticFrame(flat.frame, tierOf("lowpoly"), { mode: OPTIC_NIGHT, gain: 6, grain: 0.03 }, 3);
  expect(Array.from(flat.frame.subarray(OPTIC_AT, OPTIC_AT + 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test("a visor's window is a wide box that narrows to a slit, framed, with its zoom, view, heading and range under it, and no crosshair or compass", () => {
  const f = new UiFrame();
  const m = new HudModel();
  m.crosshair = true;
  m.visor = true;
  m.sightShape = SHAPE_VISOR;
  m.sightShare = 0.22;
  m.visorZoom = 240;
  m.visorDigital = true;
  m.visorMode = OPTIC_NIGHT;
  m.visorRange = 1240;
  m.heading = 7;
  f.begin(16 / 9);
  buildHud(f, m);
  expect(f.find(KEY_CROSS)).toBeNull();
  const texts = f.nodes.slice(0, f.count).filter((n) => n.key >= KEY_VISOR && n.key < KEY_VISOR + 40 && n.text !== "").map((n) => n.text);
  expect(texts).toEqual(["240x DIGITAL", "NIGHT", "007", "1,240 m"]);
  const box = [0, 0, 0, 0];
  windowBox(SHAPE_VISOR, 0.22, 16 / 9, box);
  // A slit: wider than tall, a fifth of the height.
  expect((box[2]! - box[0]!) * (16 / 9) / (box[3]! - box[1]!)).toBeCloseTo(VISOR_WIDE, 9);
  windowBox(SHAPE_VISOR, 0.86, 16 / 9, box);
  expect([box[0], box[2]]).toEqual([0, 1]);
});

test("the heat view: its palette runs from black through red to white as the heat rises; a body by its kind, hotter than the world however lit, a cold-blooded one cooler than a warm", () => {
  const out = [0, 0, 0];
  const luma = (t: number): number => (ironbow(t, out), out[0]! * 0.2126 + out[1]! * 0.7152 + out[2]! * 0.0722);
  let last = -1;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    expect(luma(t)).toBeGreaterThanOrEqual(last - 1e-9);
    last = luma(t);
  }
  ironbow(0, out);
  expect(out).toEqual([0, 0, 0]);
  ironbow(1, out);
  expect(out).toEqual([1, 1, 1]);
  const p = new FramePacket();
  postFrame(p.frame, tierOf("medium"), 14, 720);
  opticFrame(p.frame, tierOf("medium"), { mode: OPTIC_HEAT, gain: 1, grain: 0 }, 0);
  p.frame[FRAME.exposure] = 1;
  const seen = (code: number, light: number): number => {
    heatOfShown(code);
    const rgb = [0, 0, 0];
    shown(rgb, [light, light, light], 10, p);
    heatOfShown(0);
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  };
  // The world warms as it is lit, but no sunlit wall is as hot as a cold-blooded body in the dark.
  expect(seen(HEAT_WORLD, 0.01)).toBeLessThan(seen(HEAT_WORLD, 50));
  expect(seen(HEAT_WORLD, 50)).toBeLessThan(seen(HEAT_COLD, 0));
  expect(seen(HEAT_COLD, 0)).toBeLessThan(seen(HEAT_WARM, 0));
  expect(seen(HEAT_WARM, 0)).toBeLessThan(seen(HEAT_HOT, 0));
  // A body is as hot however it is lit.
  expect(seen(HEAT_WARM, 50)).toBe(seen(HEAT_WARM, 0));
  const v = new Visor();
  expect([v.mode, (v.cycle(), v.mode), (v.cycle(), v.mode), (v.cycle(), v.mode)]).toEqual([OPTIC_NONE, OPTIC_NIGHT, OPTIC_HEAT, OPTIC_NONE]);
});

test("a glass clicks between its steps on the wheel, ranges what it is on after a second's lasing, forgets it lowered, and shakes less crouched and least lying down", () => {
  const optic = { min: 2, max: 30, steps: [2, 4, 8, 16, 30] };
  const g = new Glass();
  expect(g.zoom(optic)).toBe(2);
  g.wheel(optic, -1);
  g.wheel(optic, -3);
  expect(g.zoom(optic)).toBe(8);
  for (let k = 0; k < 9; k++) g.wheel(optic, -1);
  expect(g.zoom(optic)).toBe(30);
  g.wheel(optic, 1);
  expect(g.zoom(optic)).toBe(16);
  g.raise(true);
  g.lase(1000);
  expect([g.ranged(1500, () => 1234, 45), g.lasing]).toEqual([false, 1000]);
  expect([g.ranged(2000, () => 1234, 45), g.range, g.bearing, g.lasing]).toEqual([true, 1234, 45, -1]);
  g.raise(false);
  expect(g.range).toBe(0);
  const most = (stance: number): number => {
    let m = 0;
    const out = [0, 0];
    for (let t = 0; t < 20000; t += 37) {
      g.shake(t, stance, out);
      m = Math.max(m, Math.hypot(out[0]!, out[1]!));
    }
    return m;
  };
  expect(most(STANCE_STAND)).toBeLessThanOrEqual(SHAKE * Math.SQRT2);
  expect(most(STANCE_CROUCH)).toBeLessThan(most(STANCE_STAND) * 0.5);
  expect(most(STANCE_PRONE)).toBeLessThan(most(STANCE_CROUCH) * 0.3);
});

test("a glass's lenses show its zoom, its range or that it lases, the bearing and a mark just made; a spotted creature is marked over it and on the map", () => {
  const f = new UiFrame();
  const m = new HudModel();
  m.scope = m.glass = true;
  m.sightShape = SHAPE_TWIN;
  m.sightShare = 0.6;
  m.glassZoom = 16;
  m.glassRange = -1;
  f.begin(16 / 9);
  buildHud(f, m);
  const words = (): string[] => f.nodes.slice(0, f.count).filter((n) => n.key >= KEY_GLASS && n.key < KEY_GLASS + 4).map((n) => n.text);
  expect(words()).toEqual(["16x", "LASING"]);
  m.glassRange = 812.4;
  m.glassBearing = 9;
  m.glassMarked = true;
  m.spots[0] = { u: 0.25, v: 0.5 };
  m.spotCount = 1;
  f.begin(16 / 9);
  buildHud(f, m);
  expect(words()).toEqual(["16x", "812 m", "009", "MARKED"]);
  expect(f.find(KEY_SPOT)!.x).toBeCloseTo(f.width / 4 - 4.5, 6);
  expect(MARKER_TINT.spotted).toBeGreaterThan(0);
});

test("the sniper's sight: a zero lifts the shot by its exact angle, breath held steadies the sway, the rifle's own scope counts as one, and an aimed look's 256ths cross the wire", () => {
  const reg = compileContent(CORE_CONTENT).registry!;
  const rifle = reg.index.get("core:rifle_sniper")!, w = reg.weapon[rifle]!, move = reg.move[reg.index.get("core:survivor")!]!;
  const b = new Body();
  aimShot(b, BTN_SECONDARY, w, move, 100, 50, false, 7, 30);
  const flat = shotAim.pitch;
  const zero = zeroUnits(500, 850, 9.81);
  expect(zero).toBeCloseTo(((9.81 * 500) / (2 * 850 * 850)) * (65536 / (2 * Math.PI)), 9);
  aimShot(b, BTN_SECONDARY, w, move, 100, 50, false, 7, 30, zero);
  expect(shotAim.pitch - flat).toBeCloseTo(zero, 9);
  expect([zeroUnits(0, 850, 9.81), zeroUnits(500, 0, 9.81)]).toEqual([0, 0]);
  // Breath: aimed with the sprint key, standing still; not moving and not unaimed.
  expect([holdsBreath(b, BTN_SECONDARY | BTN_SPRINT), holdsBreath(b, BTN_SPRINT), holdsBreath(b, BTN_SECONDARY)]).toEqual([true, false, false]);
  b.vx = 2;
  expect(holdsBreath(b, BTN_SECONDARY | BTN_SPRINT)).toBe(false);
  sway(w, STANCE_STAND, 7, 40);
  const loose = Math.hypot(swayOut.yaw, swayOut.pitch);
  sway(w, STANCE_STAND, 7, 40, BREATH_STEADY);
  expect(Math.hypot(swayOut.yaw, swayOut.pitch)).toBeCloseTo(loose * BREATH_STEADY, 9);
  // Its own scope: in hand, nothing fitted, it is scoped.
  const inv = new Inventory(60, 40);
  inv.set(inv.hotbar, rifle, 1, 0, 70, 0);
  expect(scopeFitted(reg, inv, inv.hotbar)).toBe(true);
  inv.set(inv.hotbar, reg.index.get("core:rifle")!, 1, 0, 70, 0);
  expect(scopeFitted(reg, inv, inv.hotbar)).toBe(false);
  // The fine look crosses the wire and only where it is.
  const out = new InputBuffer(64), back = new InputBuffer(64);
  out.set(10, 0, 0, 1000, -20, BTN_SECONDARY, 77, -40);
  out.set(11, 0, 0, 1000, -20, BTN_SECONDARY, 77, -40);
  out.set(12, 0, 0, 1001, -20, 0);
  const wr = new BitWriter(256);
  writeInputs(wr, out, 0, 12, 3);
  const r = new BitReader();
  r.reset(wr.bytes());
  r.bits(4);
  r.u32();
  r.u8();
  expect(readInputs(r, back, 0)).toBe(12);
  expect([back.fineYaw[10 & back.mask], back.finePitch[11 & back.mask], back.fineYaw[12 & back.mask]]).toEqual([77, -40, 0]);
});

test("a milliradian reticle's marks are a milliradian apart at the view's field, so they spread as the scope zooms, and say its zoom and zero", () => {
  const f = new UiFrame();
  const m = new HudModel();
  m.scope = m.sightMil = true;
  const gap = (fov: number): number => {
    m.sightFov = fov;
    f.begin(16 / 9);
    buildHud(f, m);
    // The first two marks right of the middle, on the horizontal line.
    const marks = f.nodes.slice(0, f.count).filter((n) => n.key > KEY_MIL + 1 && n.key < KEY_MIL + 90 && n.w < 3 && n.x > f.width / 2).map((n) => n.x).sort((a, b) => a - b);
    return marks[1]! - marks[0]!;
  };
  const base = (70 * Math.PI) / 180;
  // At 20 and 40 times each milliradian is marked; under that, each fifth.
  const at20 = gap(zoomed(base, 20)), at40 = gap(zoomed(base, 40));
  expect(at40 / at20).toBeCloseTo(2, 2);
  expect(gap(zoomed(base, 10))).toBeCloseTo(5 * (f.height / (2 * Math.tan(zoomed(base, 10) / 2))) * 0.001, 3);
  expect(at40).toBeCloseTo((f.height / (2 * Math.tan(zoomed(base, 40) / 2))) * 0.001, 3);
  m.sightZoom = 24;
  m.sightZero = 300;
  f.begin(16 / 9);
  buildHud(f, m);
  expect([f.find(KEY_MIL + 99)!.text, f.find(KEY_MIL + 98)!.text]).toEqual(["24x", "ZERO 300 m"]);
});
