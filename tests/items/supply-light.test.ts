// A supply drop's own light (client/core/render/supply-light.ts) and how it reaches a program: the material flag that
// blends it, the two street materials, the draw's effect, and the texts that read it.

import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { SupplyBeacons } from "../../client/core/render/supply-beacon.ts";
import { PROGRAMS } from "../../client/core/render/programs.ts";
import { DETAIL, DETAIL_GLOW, DRAW_BLEND, DRAW_EMISSIVE, DRAW_TEXTURED, FramePacket, moved, texturedFlags } from "../../client/core/render/packet.ts";
import { StreetDraws } from "../../client/core/render/street-draws.ts";
import { DROP_GLSL, GLOW_JET, LAMP_BEAT, LAMP_PERIOD, LIGHT_LAMP, LIGHT_LANTERN, LIGHT_SEAM, dropGlow, dropLight, dropTint, lampBeat, packEffect } from "../../client/core/render/supply-light.ts";
import { beaconLight } from "../../client/core/render/detailtext.ts";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { CHANNEL, DROP_GLOW, DROP_LIGHT, INSTRUMENT, streetMaterial } from "../../content/street-finishes.ts";
import { starterBook } from "../../content/supply/starter.ts";
import { MATERIAL_BLEND, MATERIAL_CUTOUT, MATERIAL_TWO_SIDED } from "../../shared/pack/pack.ts";

const BLUE = 0x3a7bff;
const light = (row: number, across: number, e: readonly [number, number, number, number]): number[] => {
  const out = [0, 0, 0];
  dropLight(out, row, across, ...e);
  return out;
};
const glow = (row: number, u: number, facing: number, e: readonly [number, number, number, number]): { rgb: number[]; a: number } => {
  const rgb = [0, 0, 0];
  const a = dropGlow(rgb, row, u, facing, ...e);
  return { rgb, a };
};
const sum = (v: readonly number[]): number => v[0]! + v[1]! + v[2]!;

test("a capsule keeps its tier, ring and seed and its light keeps its hue", () => {
  for (const [count, ringed, look] of [[1, false, 0], [7, true, 255], [15, true, 128]] as const) {
    const w = packEffect(count, ringed, look);
    expect([Math.fround(w), w % 16, Math.floor(w / 16) % 2 === 1, Math.floor(w / 32)]).toEqual([w, count, ringed, look]);
  }
  // A tier's colour is light as it is: every tier of the starter book keeps its hue's order, and a float holds it whole.
  for (const tier of starterBook().tiers) {
    const t = [0, 0, 0];
    dropTint(tier.rgb, t);
    const [r, g, b] = [tier.rgb >> 16, (tier.rgb >> 8) & 255, tier.rgb & 255];
    expect([Math.fround(tier.rgb), t[0]! > t[1]! === r > g, t[1]! > t[2]! === g > b, t.every((c) => c >= 0 && c <= 1)]).toEqual([tier.rgb, true, true, true]);
  }
  const white = [0, 0, 0];
  dropTint(0xffffff, white);
  expect(white).toEqual([1, 1, 1]);
});

test("the mast lamp flashes the tier's count and rests, and is never wholly out", () => {
  for (const count of [1, 3, 7]) {
    let flashes = 0;
    let was = false;
    let least = 1;
    for (let t = 0; t < LAMP_PERIOD; t += 0.01) {
      const b = lampBeat(t, count);
      least = Math.min(least, b);
      const on = b > 0.6;
      if (on && !was) flashes++;
      was = on;
    }
    expect([flashes, least, lampBeat(count * LAMP_BEAT + 0.1, count)]).toEqual([count, 0.12, 0.12]);
    // And the same every eight seconds.
    expect(lampBeat(0.21 + 5 * LAMP_PERIOD, count)).toBeCloseTo(lampBeat(0.21, count), 6);
  }
  // Before it lands the seconds are negative, and it flashes the same.
  expect(lampBeat(-LAMP_PERIOD + 0.1, 2)).toBeCloseTo(lampBeat(0.1, 2), 9);
});

test("the mast glow faces an eye directly above or below the capsule", () => {
  const beacons = new SupplyBeacons();
  const frame = { cam: new Camera(), packet: new FramePacket(), viewHeight: 1080 };
  for (const sign of [-1, 1]) {
    frame.cam.pitch = sign * Math.PI / 2;
    frame.cam.update();
    frame.packet.beginFrame();
    beacons.begin();
    expect(beacons.add(frame, 0, sign * 20, 0, 0, 1, BLUE, false)).toBe(false);
    beacons.write(frame.packet);
    const p = frame.packet;
    expect(p.detailCount).toBe(1);
    expect((p.detailWords[DETAIL.misc]! >>> 8) & 255).toBe(DETAIL_GLOW);
    expect(Math.abs(p.details[DETAIL.across]! * p.details[DETAIL.along + 2]!)).toBeGreaterThan(1);
  }
});

test("the camera sees a growing shaft only when its tip reaches the view", () => {
  const beacons = new SupplyBeacons();
  const frame = { cam: new Camera(), packet: new FramePacket(), viewHeight: 1080 };
  frame.cam.update();
  expect(beacons.add(frame, 0, -150, 100, 0.05, 1, BLUE, false)).toBe(false);
  expect(beacons.count).toBe(0);
  expect(beacons.add(frame, 0, -150, 100, 0.5, 1, BLUE, false)).toBe(true);
});

test("the beam feathers at its sides and tip and carries a steady pale core", () => {
  const shape = (x: number, y: number, core = 1) => {
    const result = [0, 0];
    beaconLight(x, y, core, result);
    return result;
  };
  expect(shape(0, -1)).toEqual(shape(0, 0.6));
  expect(shape(0, 0)).toEqual([1, 0.58]);
  expect(shape(1, 0)).toEqual([0, 0]);
  expect(shape(0, 1)[0]).toBeCloseTo(0);
  expect(shape(-0.25, 0)).toEqual(shape(0.25, 0));
  expect(shape(0.6, 0)[0]).toBeLessThan(shape(0.2, 0)[0]!);
  expect(shape(0.3, 0, 0.6)[1]).toBeCloseTo(shape(0.5, 0)[1]!);
});

test("a lit strip is the tier's colour, brighter as the lantern opens and hottest along its middle; the lamp keeps its beat", () => {
  const shut = light(LIGHT_LANTERN, 0, [5, BLUE, 0, packEffect(3, false, 9)]);
  const open = light(LIGHT_LANTERN, 0, [5, BLUE, 1, packEffect(3, false, 9)]);
  const edge = light(LIGHT_LANTERN, 0.95, [5, BLUE, 1, packEffect(3, false, 9)]);
  expect([sum(open) > 3 * sum(shut), sum(open) > 1.5 * sum(edge), shut[2]! > shut[0]!, edge[2]! > edge[0]!, sum(shut) > 0]).toEqual([true, true, true, true, true]);
  // The lamp: lit on a flash, dim between groups, whatever the lantern does.
  const e = (seconds: number, power: number) => [seconds, BLUE, power, packEffect(3, false, 9)] as const;
  expect([sum(light(LIGHT_LAMP, 0, e(0.12, 0))) > 4 * sum(light(LIGHT_LAMP, 0, e(4, 0))), light(LIGHT_LAMP, 0, e(0.12, 0)), light(LIGHT_SEAM, 0, e(1, 0))]).toEqual([true, light(LIGHT_LAMP, 0, e(0.12, 1)), light(LIGHT_SEAM, 0, e(77, 1))]);
});

test("the jet fades outward from its bell and follows the engine power", () => {
  const e = (power: number) => [3, BLUE, power, packEffect(4, true, 40)] as const;
  expect(glow(GLOW_JET, 0.1, 1, e(0)).a).toBe(0);
  // A jet: brightest at the bell, nothing at its end, and its bands travel outward.
  expect([glow(GLOW_JET, 0.05, 1, e(1)).a > 0.6, glow(GLOW_JET, 0.6, 1, e(1)).a < glow(GLOW_JET, 0.2, 1, e(1)).a, glow(GLOW_JET, 1, 1, e(1)).a, glow(GLOW_JET, 1.4, 1, e(1)).a]).toEqual([true, true, 0, 0]);
});

test("a material flagged as light with no surface is drawn blended, and the capsule's two lights keep their street materials whatever else a draw says", () => {
  expect([texturedFlags(MATERIAL_BLEND) & DRAW_BLEND, texturedFlags(MATERIAL_TWO_SIDED | MATERIAL_CUTOUT) & DRAW_BLEND, texturedFlags(MATERIAL_BLEND) & DRAW_TEXTURED]).toEqual([DRAW_BLEND, 0, DRAW_TEXTURED]);
  expect([streetMaterial("core:supply-capsule/capsule"), streetMaterial("core:supply-capsule/light"), streetMaterial("core:supply-capsule/glow")]).toEqual([INSTRUMENT, DROP_LIGHT, DROP_GLOW]);
  const art = {
    meshes: [{ id: "core:supply-capsule/hull" }, { id: "core:zztide_eye_crown_light" }],
    materials: [{ id: "core:supply-capsule/capsule" }, { id: "core:supply-capsule/light" }, { id: "core:supply-capsule/glow", flags: MATERIAL_BLEND }, { id: "core:tide-eye/instrument" }],
  };
  const draws = new StreetDraws(art, []);
  const p = new FramePacket();
  const put = (mesh: number, material: number, flags: number): number => {
    const d = p.drawCount++;
    p.drawMesh[d] = mesh;
    p.drawMaterial[d] = material;
    p.drawFlags[d] = flags;
    return d;
  };
  const body = put(0, 0, DRAW_TEXTURED);
  const strip = put(0, 1, DRAW_TEXTURED | DRAW_EMISSIVE);
  const shaft = put(0, 2, texturedFlags(MATERIAL_BLEND) | DRAW_EMISSIVE);
  const eye = put(1, 3, DRAW_TEXTURED | DRAW_EMISSIVE);
  const flat = put(0, 1, DRAW_EMISSIVE);
  p.drawStreetMaterial[flat] = 77;
  draws.write(p);
  // An instrument's own light is a channel still; a draw with no material is left as it was.
  expect([body, strip, shaft, eye, flat].map((d) => p.drawStreetMaterial[d])).toEqual([INSTRUMENT, DROP_LIGHT, DROP_GLOW, CHANNEL, 77]);
});

test("a frame clears every draw's effect, and the programs that draw a drop's lights read it", () => {
  const p = new FramePacket();
  p.drawEffect.fill(3);
  p.beginFrame();
  expect(p.drawEffect.every((v) => v === 0)).toBe(true);
  const high = TIERS.find((t) => t.name === "high")!;
  const low = TIERS.find((t) => !t.lit)!;
  for (const name of ["surface", "surfaceWhole", "surfaceUndyed", "surfaceUndyedWhole", "surfaceLayer"]) {
    const text = PROGRAMS[name]!(high, "bc").fragment;
    expect([name, text.includes("uniform vec4 uEffect;"), text.includes(`int(uStreetMaterial) == ${DROP_LIGHT}`), text.includes(`int(uStreetMaterial) == ${DROP_GLOW}`), text.includes("vec4 dropGlow(")]).toEqual([name, true, true, true, true]);
  }
  for (const tier of [high, low]) {
    const text = PROGRAMS.signal!(tier, "bc").fragment;
    expect([text.includes("uniform vec4 uEffect;"), text.includes("uEffect.y > 0. ? dropLight(")]).toEqual([true, true]);
  }
  // The text is the arithmetic the software renderer runs: each constant is written into it from the one it reads.
  for (const v of [LAMP_PERIOD, LAMP_BEAT]) expect(DROP_GLSL).toContain(Number.isInteger(v) ? `${v}.0` : String(v));
});

test("a renderer sets a program's vector only when it has moved: the numbers it keeps are made the draw's as they are compared", () => {
  const last = new Float64Array(12).fill(NaN);
  const from = Float32Array.of(9, 9, 1.5, BLUE, 0.25, 77, 9);
  // Never set: it has moved. Set to the same again: it has not. Any one of the four different: it has.
  expect([moved(last, 5, from, 2, 4), [...last.subarray(5, 9)], moved(last, 5, from, 2, 4)]).toEqual([true, [1.5, BLUE, 0.25, 77], false]);
  for (let k = 2; k < 6; k++) {
    from[k]! += 1;
    expect([moved(last, 5, from, 2, 4), moved(last, 5, from, 2, 4)]).toEqual([true, false]);
  }
  // It writes its own places and no others.
  expect([Number.isNaN(last[4]!), Number.isNaN(last[9]!)]).toEqual([true, true]);
  // Three numbers, as a draw's offset is kept.
  expect([moved(last, 0, Float32Array.of(1, 2, 3), 0, 3), moved(last, 0, Float32Array.of(1, 2, 3), 0, 3), moved(last, 0, Float32Array.of(1, 2, 4), 0, 3), Number.isNaN(last[3]!)]).toEqual([true, false, true, true]);
});
