// A vehicle's glass where its own mesh holds the pane, seen through by half of each pixel (client/core/render/vehicle-glass.ts).
import { expect, test } from "bun:test";
import { CONCEPT003_ART } from "../../content/vehicles/concept003-art.ts";
import { Windscreens, paneOptics } from "../../client/core/render/windscreens.ts";
import { GLASS } from "../../content/vehicles/glass.ts";
import { effectsOff, packetWithout } from "../../client/core/passes.ts";
import { BONE_FLOATS, DETAIL, DRAW_CUTOUT, DRAW_TEXTURED, FramePacket } from "../../client/core/render/packet.ts";
import { PROGRAMS } from "../../client/core/render/programs.ts";
import { StreetDraws } from "../../client/core/render/street-draws.ts";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { CARD_FORWARD, OPTICS_CUT, VEHICLE_GLASS_GLSL, glassAt, glassCovers, glassReflected, glassSet, opticsGlass } from "../../client/core/render/vehicle-glass.ts";

test("each glass set's materials find their set, and a texel is a pane's only in its cells, and not on a carded windscreen", () => {
  expect(glassSet("core:road_van/fittings")).toBe(1);
  expect(glassSet("core:compact_abandoned/cabin")).toBe(GLASS.findIndex((g) => g.materials.includes("core:compact_abandoned/cabin")) + 1);
  expect([glassSet("core:compact/cabin"), glassSet("core:road_van/coach"), glassSet("")]).toEqual([0, 0, 0]);
  GLASS.forEach((g, k) => {
    for (const [u0, v0, u1, v1] of g.cells) {
      expect(u0).toBeLessThan(u1);
      expect(v0).toBeLessThan(v1);
      const [u, v] = [(u0 + u1) / 2, (v0 + v1) / 2];
      // Seen from the side, inside the cell, and the same a whole picture on, as the material repeats.
      expect(glassAt(k + 1, u, v, 0)).toBe(true);
      expect(glassAt(k + 1, u + 1, v - 1, 0)).toBe(true);
      expect(glassAt(k + 1, u1 + 0.001, v, 0)).toBe(g.cells.some((c) => u1 + 0.001 >= c[0] && u1 + 0.001 < c[2] && v >= c[1] && v < c[3]));
      // A face turned forward is the windscreen, which its card draws where the set says so.
      expect(glassAt(k + 1, u, v, CARD_FORWARD + 0.1)).toBe(!g.card);
    }
  });
  expect(glassAt(0, 0.3, 0.6, 0)).toBe(false);
});

test("a pane covers half of each pixel, and sends back the more of the light the more it is seen at a glance", () => {
  // Square on it sends back about 7 % and more at a glance, never all of it.
  expect(glassReflected(1, 0)).toBeCloseTo(0.07, 3);
  expect(glassReflected(0.3, 0)).toBeGreaterThan(0.25);
  expect(glassReflected(0, 1)).toBe(0.86);
  // Half of every pixel's samples, or, with none, every other pixel: a checkerboard repeating every four pixels.
  let kept = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    expect(glassCovers(true, x, y)).toBe(0.5);
    const c = glassCovers(false, x, y);
    expect(c).toBe((x + y) % 2 === 0 ? 1 : 0);
    expect(glassCovers(false, x + 4, y + 8)).toBe(c);
    kept += c;
  }
  expect(kept).toBe(8);
});

test("a draw's optics hold its spokes and its glass, and with the glass off a draw cut out only for it is as it was", () => {
  const p = new FramePacket();
  p.drawCount = 3;
  p.drawFlags[0] = DRAW_TEXTURED | DRAW_CUTOUT;
  p.drawOptics[0] = 1 + 2 * 3 + OPTICS_CUT;
  p.drawFlags[1] = DRAW_TEXTURED | DRAW_CUTOUT;
  p.drawOptics[1] = 2 * 4;
  p.drawFlags[2] = DRAW_TEXTURED;
  p.drawOptics[2] = 1;
  expect([0, 1, 2].map((d) => opticsGlass(p.drawOptics[d]!))).toEqual([3, 4, 0]);
  packetWithout(p, effectsOff("glass"));
  expect([...p.drawOptics.subarray(0, 3)]).toEqual([1, 0, 1]);
  expect([...p.drawFlags.subarray(0, 3)]).toEqual([DRAW_TEXTURED, DRAW_TEXTURED | DRAW_CUTOUT, DRAW_TEXTURED]);
});

test("a draw takes its material's glass once the material's id has come with its page, and is cut out for it", () => {
  const materials = [{ id: "" }, { id: "" }];
  const streets = new StreetDraws({ meshes: [{ id: "core:patrol_jeep" }], materials }, []);
  const p = new FramePacket();
  p.drawCount = 1;
  p.drawFlags[0] = DRAW_TEXTURED;
  p.drawMaterial[0] = 1;
  streets.write(p);
  expect([p.drawOptics[0], p.drawFlags[0]]).toEqual([0, DRAW_TEXTURED]);
  materials[1]!.id = "core:patrol_jeep/patrol";
  streets.write(p);
  expect([opticsGlass(p.drawOptics[0]!), p.drawOptics[0]! & OPTICS_CUT, p.drawFlags[0]]).toEqual([glassSet("core:patrol_jeep/patrol"), OPTICS_CUT, DRAW_TEXTURED | DRAW_CUTOUT]);
});

test("only the cut-out surface programs read the glass, and every set's cells are in their text", () => {
  const tier = TIERS[2]!;
  expect(PROGRAMS.surface!(tier, "astc").fragment).toContain("cover = glassCovers()");
  expect(PROGRAMS.surfaceWhole!(tier, "astc").fragment).not.toContain("glassAt");
  const cells = GLASS.reduce((n, g) => n + g.cells.length, 0);
  expect(VEHICLE_GLASS_GLSL).toContain(`const vec4 GLASS_CELLS[${cells}]`);
  expect(VEHICLE_GLASS_GLSL).toContain(`const vec3 GLASS_SETS[${GLASS.length}]`);
});

test("the Concept driver's road ray passes through its intact windscreen", () => {
  const p = new FramePacket(), glass = new Windscreens(), car = CONCEPT003_ART;
  p.lit = true;
  p.tier = TIERS[0]!;
  p.bones[0] = p.bones[5] = p.bones[10] = 1;
  glass.add(p, 0, car.id, 12, 3);
  glass.write(p);
  expect(p.detailCount).toBe(1);
  const d = p.details, eye = car.anchors.camera_driver, slope = Math.tan(-.07);
  const t = (eye[1] + (d[2]! - eye[2]) * slope - d[1]!) / (d[DETAIL.along+1]! - slope * d[DETAIL.along+2]!);
  expect(Math.abs(t)).toBeLessThan(1);
  const width = d[DETAIL.across]! * (1 + (d[DETAIL.floor]! - 1) * (1 + t) / 2);
  expect(Math.abs(eye[0] - d[0]!)).toBeLessThan(width);
  const dy = d[DETAIL.along+1]!, dz = d[DETAIL.along+2]!, optics = new Float64Array(2);
  paneOptics((dz * slope - dy) / (Math.hypot(dz, dy) * Math.hypot(1, slope)), t, .5, .35, optics);
  expect(optics[0]).toBeGreaterThan(0);
  expect(optics[0]).toBeLessThan(.25);
  glass.begin();
  glass.add(p, 0, car.id, 12, 0, 1 << car.breakablePanels.findIndex(v => v.bone === "glass_front"));
  expect(glass.count).toBe(0);
});

test("six Concept glass sheets follow their own bones and vanish independently", () => {
  const p = new FramePacket(), sheets = new Windscreens(), car = CONCEPT003_ART;
  p.lit = true;
  p.tier = TIERS[2]!;
  const bones = Int16Array.from(car.breakablePanels, panel => car.bones.indexOf(panel.bone));
  for (let bone = 0; bone < car.bones.length; bone++) {
    const o = bone * BONE_FLOATS;
    p.bones[o] = p.bones[o+5] = p.bones[o+10] = 1;
  }
  const panes = car.breakablePanels.map((panel, i) => panel.bone.startsWith("glass_") ? i : -1).filter(i => i >= 0);
  const mask = panes.reduce((mask, i) => mask | (1 << i), 0);
  sheets.add(p, 0, car.id, 5, 0, 0, bones);
  expect(sheets.count).toBe(6);
  for (const i of panes) {
    sheets.begin();
    p.detailCount = 0;
    sheets.add(p, 0, car.id, 5, 1, mask ^ (1 << i), bones);
    sheets.write(p);
    expect(p.detailCount).toBe(1);
    const x = p.details[0]!, offset = bones[i]! * BONE_FLOATS + 3;
    p.bones[offset] = .36;
    sheets.begin();
    p.detailCount = 0;
    sheets.add(p, 0, car.id, 5, 1, mask ^ (1 << i), bones);
    sheets.write(p);
    expect(p.details[0]).toBeCloseTo(x + .36);
    p.bones[offset] = 0;
  }
});
