// Light from fire (client/core/render/fire-lights.ts): the strongest few round the eye written to the frame and the rest
// left out by degrees, each falling off by the square of the distance to nothing at its reach, taken by every lit
// program, the smoke and the sea where the tier carries it, and given by burning wrecks and blasts in a frame.

import { expect, test } from "bun:test";
import { TIERS, forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { effectsOff, packetWithout } from "../../client/core/passes.ts";
import { FIRE_COLOUR, FIRE_GLINT, FIRE_NEAREST, FIRE_REACH_PER, FIRE_SEES_GLSL, FireLights, fireCast, fireReach, fireSees } from "../../client/core/render/fire-lights.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_GLOW, FIRES_AT, FIRE_LIGHTS, FRAME, FRAME_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { PROGRAMS, withDefines } from "../../client/core/render/programs.ts";
import { seaPixel } from "../../client/core/render/water.ts";
import { burningKind } from "../../content/docks.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { SURFACE_GROUND } from "../../shared/net/rockets.ts";
import { provingView } from "../../tools/snap.ts";

const [R, G, B] = FIRE_COLOUR;

/** The lights a frame holds, as [x, y, z, reach, r, g, b] each, the written ones only. */
function written(frame: Float32Array): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < FIRE_LIGHTS && frame[FIRES_AT + k * 8 + 3]! > 0; k++) out.push(Array.from(frame.subarray(FIRES_AT + k * 8, FIRES_AT + k * 8 + 7)));
  return out;
}

test("the strongest lights round the eye are written first, as many as asked, and the lanes past them are none", () => {
  const lights = new FireLights(), frame = new Float32Array(FRAME_FLOATS).fill(7);
  frame[FRAME.exposure] = 1;
  lights.begin();
  // A wreck's strong fire 50 m off, a campfire 5 m off and a torch 3 m off: by what each throws round the eye, the torch, the campfire, the wreck.
  lights.add(0, 0, 50, 100, R, G, B, 1);
  lights.add(0, 0, 5, 4, R, G, B, 1);
  lights.add(3, 0, 0, 2, R, G, B, 1);
  lights.write(frame, 2, 0);
  const two = written(frame);
  expect(two.map((l) => [l[0], l[2], Math.round(l[3]! * 100) / 100])).toEqual([[3, 0, Math.round(FIRE_REACH_PER * Math.sqrt(2) * 100) / 100], [0, 5, Math.round(FIRE_REACH_PER * 2 * 100) / 100]]);
  // Its colour is its light a metre off: the torch is whole, the wreck far past the cut.
  expect(two[0]!.slice(4)).toEqual([2 * R, 2 * G, 2 * B].map((v) => Math.fround(v)));
  expect(Array.from(frame.subarray(FIRES_AT + 16, FIRES_AT + FIRE_LIGHTS * 8)).every((v) => v === 0)).toBe(true);
  // Asked for none, or with none to give, it writes none and clears what was there.
  lights.write(frame, 0, 0);
  expect(written(frame)).toEqual([]);
  lights.begin();
  lights.write(frame.fill(3), 4, 0);
  expect(Array.from(frame.subarray(FIRES_AT, FIRES_AT + FIRE_LIGHTS * 8)).every((v) => v === 0)).toBe(true);
});

test("a light nearing the last of the few fades as it nears it, so two changing places never pop", () => {
  const lights = new FireLights(), frame = new Float32Array(FRAME_FLOATS);
  // One light asked for; a second as strong walks in from 20 m to 4 m. The first's written light never steps.
  let last = -1, most = 0;
  for (let d = 20; d >= 4; d -= 0.05) {
    lights.begin();
    lights.add(0, 0, 8, 10, R, G, B, 1);
    lights.add(d, 0, 0, 10, R, G, B, 1);
    lights.write(frame, 1, 0);
    const shown = frame[FIRES_AT + 3]! > 0 && frame[FIRES_AT] === 0 ? frame[FIRES_AT + 4]! : -frame[FIRES_AT + 4]!;
    if (last !== -1) most = Math.max(most, Math.abs(shown - last));
    last = shown;
  }
  expect(most).toBeLessThan(0.5);
});

test("a fire lights a face turned to it by the square of the distance, a little turned away, and nothing past its reach", () => {
  const frame = new Float32Array(FRAME_FLOATS);
  const lights = new FireLights();
  lights.begin();
  lights.add(0, 2, 0, 16, R, G, B, 1);
  lights.write(frame, 4, 0);
  const reach = FIRE_REACH_PER * 4;
  expect(frame[FIRES_AT + 3]).toBeCloseTo(reach, 5);
  // A floor under it, facing up: twice as far is under a quarter as lit, nothing at its reach, and held a share of its reach under it.
  const at = (x: number, ny = 1): number => fireReach(frame, 0, x, 0, 0, 0, ny, 0);
  expect(at(6) / at(3)).toBeLessThan(0.25);
  expect(at(reach)).toBe(0);
  // Within that share of its reach its strength is level, and a face is lit by its true way to the light.
  expect(fireReach(frame, 0, 0, 1, 0, 0, 1, 0)).toBeCloseTo(fireReach(frame, 0, 0, 0.5, 0, 0, 1, 0), 9);
  expect(fireReach(frame, 0, 0, 1, 0, 0, 1, 0)).toBeCloseTo((1 / (FIRE_NEAREST * reach) ** 2) * (1 - FIRE_NEAREST ** 4) ** 2, 6);
  expect(fireReach(frame, 0, 1, 2, 0, 0, 1, 0)).toBeCloseTo(0.2 * fireReach(frame, 0, 0, 1, 0, 0, 1, 0), 6);
  // A wall facing it takes more than the floor beside it, and one facing away a little or none.
  expect(fireReach(frame, 0, 3, 2, 0, -1, 0, 0)).toBeGreaterThan(at(3));
  expect(fireReach(frame, 0, 3, 2, 0, 1, 0, 0)).toBe(0);
  // The twin sums the lights into fireCast, its colour by the share; off, none.
  fireSees(frame, true, 1, 0, 0, 0, 1, 0);
  expect(fireCast[0]!).toBeCloseTo(frame[FIRES_AT + 4]! * at(1), 6);
  fireSees(frame, false, 1, 0, 0, 0, 1, 0);
  expect(Array.from(fireCast)).toEqual([0, 0, 0]);
  // The text is the twin's arithmetic, and stops at the first lane with no light.
  expect(FIRE_SEES_GLSL).toContain("if (at.w <= 0.0) break;");
  expect(FIRE_SEES_GLSL).toContain("gFire += fFires[2 * k + 1].rgb * (w * w / r2) * max(0.20 + 0.80 * dot(normal, d) * inversesqrt(d2), 0.0);");
});

test("the sea glints with the strongest fire where the eye looks down the line to it, and not with none", () => {
  const frame = new Float32Array(FRAME_FLOATS), table = new Uint8Array(32 * 32 * 64 * 4);
  const lights = new FireLights();
  lights.begin();
  lights.add(0, 2, 20, 60, R, G, B, 1);
  lights.write(frame, 4, 0);
  const up = [0, 1, 0], eye = Math.SQRT1_2;
  // Halfway to it, looking down at the water at the angle it is mirrored at.
  const at = [0, -2, 10], v = [0, eye, -eye];
  const lit = seaPixel(frame, table, up, v, 3, 0.002, 1, 0, undefined, at);
  const dark = seaPixel(new Float32Array(FRAME_FLOATS), table, up, v, 3, 0.002, 1, 0, undefined, at);
  expect(lit.light[0]! - dark.light[0]!).toBeGreaterThan(0);
  expect(lit.light[0]! - dark.light[0]!).toBeGreaterThan(2 * (lit.light[2]! - dark.light[2]!));
  // It is held to a fire's most, after exposure, however strong the light and however smooth the water: an orange streak, no sun's.
  for (const exposure of [1, 40000]) {
    const strong = new Float32Array(FRAME_FLOATS), none = new Float32Array(FRAME_FLOATS);
    strong[FRAME.exposure] = none[FRAME.exposure] = exposure;
    lights.begin();
    lights.add(0, 2, 20, 5000, R, G, B, 1);
    lights.write(strong, 4, 0);
    // The eye where the water mirrors the fire: the way to it turned over.
    const l = Math.hypot(4, 10), mirror = [0, 4 / l, -10 / l];
    const a = seaPixel(strong, table, up, mirror, 3, 0, 1, 0, undefined, at), b = seaPixel(none, table, up, mirror, 3, 0, 1, 0, undefined, at);
    const added = (a.light[0]! - b.light[0]!) * exposure;
    // What is shown is the glint over how much of the water it covers, a little over the glint itself.
    expect([added > 0.2, added <= 1.1 * FIRE_GLINT]).toEqual([true, true]);
  }
});

test("every lit program takes fire's light where the tier carries it, the smoke its glow and the sea its glint", () => {
  for (const tier of [...TIERS, forTouch(tierOf("high"), true), forTouch(tierOf("medium"), true)]) {
    const on = tier.lit && tier.fires.lights > 0;
    for (const name of ["flat", "terrain", "far", "surface", "details", "water"]) {
      const text = PROGRAMS[name]!(tier, "rgba", false, tier.post !== null);
      expect([tier.name, name, text.defines.includes("#define FIRE_LIGHT\n")]).toEqual([tier.name, name, on]);
      const fragment = withDefines(text.fragment, text.defines);
      if (!on || !tier.lit) continue;
      if (name === "water") expect(fragment).toContain("if (fFires[0].w > 0.0) {");
      else if (name === "details") expect(fragment).toContain("fire = 0.1200 * s.z * gFire;");
      else expect(fragment).toContain("light += gFire * albedo * (1.0 - mro.b);");
    }
  }
  expect(TIERS.map((t) => [t.name, t.fires.lights])).toEqual([["lowpoly", 0], ["medium", 2], ["high", 4], ["ultra", 4]]);
  // A page's switch clears the lights and nothing else.
  const p = new FramePacket();
  p.frame.fill(1);
  packetWithout(p, effectsOff("firelight"));
  expect([p.frame[FIRES_AT - 1], p.frame[FIRES_AT], p.frame[FIRES_AT + 8 * FIRE_LIGHTS - 1]]).toEqual([1, 0, 0]);
});

const view = provingView(96, 64);

test("a burning wreck lights what is near it, a blast flashes and then glows, and with no light carried a pool stands in by night", () => {
  const { scene, cam, remote, hf, structs, reg } = view;
  const [x, z] = [236, 372];
  const hull = reg.index.get(burningKind("core:jon_boat"))!;
  structs.add(hull, x, hf.heightAt(x, z) + 0.6, z, 0, 0, 1);
  remote.count = 0;
  scene.viewHeight = 720;
  [cam.x, cam.z] = [x - 2, z - 12];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.7;
  cam.yaw = 0;
  cam.pitch = -0.05;
  const frame = (tier: string, now: number): FramePacket => {
    scene.assets.tier = tierOf(tier);
    scene.now = now;
    remote.tick = (now * TICK_RATE) / 1000;
    return scene.build(cam, remote);
  };
  let p = frame("high", 1000);
  const fire = written(p.frame);
  expect(fire.length).toBe(1);
  // It stands over the wreck, about 12 m ahead.
  expect([Math.abs(fire[0]![0]! - 2) < 3, Math.abs(fire[0]![2]! - 12) < 3]).toEqual([true, true]);
  // It flickers slowly: a little at a time, and never by much.
  const strength = (q: FramePacket): number => q.frame[FIRES_AT + 4]!;
  const seen: number[] = [];
  for (let k = 0; k < 30; k++) seen.push(strength(frame("high", 1000 + k * 16)));
  for (let k = 1; k < seen.length; k++) expect(Math.abs(seen[k]! - seen[k - 1]!) / seen[k - 1]!).toBeLessThan(0.08);
  expect(Math.max(...seen) / Math.min(...seen)).toBeLessThan(1.5);
  // A blast near flashes white and brighter than the fire, then glows orange, then is gone.
  scene.blasts.burst(2, x + 4, hf.heightAt(x + 4, z - 4), z - 4, 0, 1, 0, 7.5, SURFACE_GROUND, 0, 99, 2000);
  p = frame("high", 2020);
  const flash = written(p.frame)[0]!;
  expect([flash[4]! > 5 * fire[0]![4]!, flash[6]! / flash[4]! > 0.3]).toEqual([true, true]);
  p = frame("high", 2500);
  const glow = written(p.frame).find((l) => Math.abs(l[0]! - 6) < 2)!;
  expect([glow[4]! < flash[4]!, glow[6]! / glow[4]! < flash[6]! / flash[4]!]).toEqual([true, true]);
  p = frame("high", 6000);
  expect(written(p.frame).length).toBe(1);
  // On low poly none is carried, and by night a warm pool lies under the fire; by day it is not there.
  const pools = (q: FramePacket): number => {
    let n = 0;
    for (let k = 0; k < q.detailCount; k++) {
      const o = k * DETAIL_FLOATS;
      if (((q.detailWords[o + DETAIL.misc]! >>> 8) & 255) === DETAIL_GLOW && q.details[o + DETAIL.along + 1] === 0 && q.details[o + DETAIL.across + 1] === 0) n++;
    }
    return n;
  };
  scene.hour = 23;
  p = frame("lowpoly", 9000);
  expect([written(p.frame).length, pools(p) > 0]).toEqual([0, true]);
  p = frame("high", 9100);
  expect(pools(p)).toBe(0);
  scene.hour = 12;
  p = frame("lowpoly", 9200);
  expect(pools(p)).toBe(0);
});
