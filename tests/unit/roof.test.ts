// What stands overhead (client/core/render/roof.ts, roofmap.ts): a slab 2.8 m over open ground roofs the cells under it with its
// underside's height, spread two cells past its edge; a face up keeps less of the sky deep under it than at its edge,
// and a face at its edge turned out keeps more than one turned in; a piece standing on the ground roofs nothing; a point
// over the slab, past the window or off the card keeps all of it, and none keeps less than ROOF_LEAST; the map is made
// round the camera over frames and goes on the card whole, again once the camera has gone far enough or pieces have gone,
// but not more often than it should; and only the desktop tiers' lit programs read it. Its second layer is the ground's
// colour, the tint's or a flat piece's lying on it, and the light a face gets from the ground takes the colour of the
// ground it sees, before it or, under the roof, toward the open side, and loses the sun's part where that is not lit.
// Through the scene, the rasterizer darkens the ground under a slab and leaves the open ground as it was.

import { expect, test } from "bun:test";
import { TIERS, forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { FramePacket, ROOF_AT } from "../../client/core/render/packet.ts";
import { PROGRAMS } from "../../client/core/render/programs.ts";
import { BOUNCE_LEAST, BOUNCE_SUN, GROUND, OPEN, ROOF_LAST, ROOF_BYTES, ROOF_LAYERS, ROOF_LEAST, ROOF_SIDE, roofBounce, roofOpen } from "../../client/core/render/roof.ts";
import { ROOF_EVERY, ROOF_MOVE, RoofMap, roofSteps } from "../../client/core/render/roofmap.ts";
import { FRAME } from "../../client/core/render/packet.ts";
import { bounce, skyOn } from "../../client/core/render/surface.ts";
import * as skyBuild from "../../tools/sky/build.ts";
import type { MapDims } from "../../shared/coords.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { FLOOR, cityWorld } from "../fixtures/cityworld.ts";
import { PICK_TERRAIN } from "../../tools/snap/raster.ts";
import { farRegistry } from "../fixtures/farworld.ts";

const dims: MapDims = { chunksX: 4, chunksZ: 4 };
const hf = new Heightfield(dims, TERRAIN_CELL, 0, 0.01);
/** A floor plate 8 m a side held up at 3 m, its underside at 2.8 m, and another lying on the ground. */
const city = new CityStatics(dims, [{ kind: FLOOR, x: 128, y: 3, z: 128, yaw: 0 }, { kind: FLOOR, x: 60, y: 0.2, z: 60, yaw: 0 }], farRegistry());
const none = (): null => null;
/** Asphalt the ground's tint 0, a warm walk its tint 3 from the slab's east edge, x 132, and the plate's own colour a pale grey. */
const palette = new Uint8Array(256 * 4);
palette.set([60, 60, 64, 255], 0);
palette.set([214, 190, 150, 255], 3 * 4);
palette.set([180, 180, 180, 255], city.color[city.kind[0]!]! * 4);
for (let j = 0; j < hf.nz; j++) for (let i = 132 / hf.cell; i < hf.nx; i++) hf.tint[j * hf.nx + i] = 3;

function bake(colours: Uint8Array | null = palette): Uint8Array {
  const out = new Uint8Array(ROOF_SIDE * ROOF_SIDE * ROOF_BYTES * ROOF_LAYERS);
  const steps = roofSteps(city, hf, none, 0, 0, ROOF_SIDE, out, colours);
  while (!steps.next().done);
  return out;
}
const map = bake();
const cell = (x: number, z: number, b: number, layer = 0): number => map[((layer * ROOF_SIDE + z) * ROOF_SIDE + x) * ROOF_BYTES + b]!;

test("a slab over open ground roofs the cells under it, a face up keeps more at its edge, and one there keeps most turned out", () => {
  // The plate covers cells 124 to 131 each way.
  expect([cell(128, 128, 0), cell(124, 128, 0), cell(131, 131, 0)]).toEqual([45, 45, 45]);
  // Its height spreads two cells past its edge, the cells there open to all the sky; none past that.
  expect([cell(132, 128, 0), cell(133, 128, 0), cell(134, 128, 0)]).toEqual([45, 45, 0]);
  expect([cell(132, 128, 1), cell(132, 128, 2), cell(132, 128, 3)]).toEqual([255, 128, 128]);
  expect([cell(20, 20, 0), cell(20, 20, 1)]).toEqual([0, 255]);
  // Deep under it a face up keeps less of the sky than at its edge, and the sky that gets in comes from the open side.
  expect(cell(128, 128, 1)).toBeLessThan(cell(131, 128, 1));
  expect(cell(128, 128, 1)).toBeGreaterThan(0);
  expect(cell(131, 128, 2)).toBeGreaterThan(140);
  expect(cell(131, 128, 2) - 128).toBeGreaterThan(3 * Math.abs(cell(131, 128, 3) - 128));
  expect(cell(124, 128, 2)).toBeLessThan(116);
  // The plate on the ground roofs nothing.
  expect(cell(60, 60, 0)).toBe(0);
});

test("the share a point keeps: by its face under the slab, all of it over the slab, past the window and off the card", () => {
  const frame = new Float32Array(ROOF_AT + 4);
  // The camera at (100, 1.6, 100), the window's corner at the world's.
  frame.set([-100, -100, ROOF_SIDE, 1], ROOF_AT);
  const at = (x: number, z: number, n: readonly number[], over: number): number => roofOpen(map, ROOF_SIDE, frame, x - 100, z - 100, n[0]!, n[1]!, n[2]!, over);
  const up = [0, 1, 0], out = [1, 0, 0], back = [-1, 0, 0];
  expect(at(128.5, 128.5, up, 0)).toBeCloseTo(Math.max(ROOF_LEAST, cell(128, 128, 1) / 255), 5);
  expect(at(131.5, 128.5, out, 1)).toBeGreaterThan(at(131.5, 128.5, up, 1));
  expect(at(131.5, 128.5, out, 1)).toBeGreaterThan(at(131.5, 128.5, back, 1));
  expect(at(131.5, 128.5, back, 1)).toBeGreaterThanOrEqual(ROOF_LEAST);
  // Turned across the open side, half the more a face turned to it keeps.
  const across = [0, 0, 1], u = at(131.5, 128.5, up, 1);
  expect(at(131.5, 128.5, across, 1)).toBeGreaterThan(u);
  expect(at(131.5, 128.5, across, 1)).toBeLessThan(at(131.5, 128.5, out, 1));
  // A face turned down keeps what a face up does, and a point well over the underside keeps it all.
  expect(at(128.5, 128.5, [0, -1, 0], 1)).toBeCloseTo(at(128.5, 128.5, up, 1), 5);
  expect(at(128.5, 128.5, up, 3.2)).toBe(1);
  // The underside itself, a face turned down at its height, is as under it as the floor.
  expect(at(128.5, 128.5, [0, -1, 0], 2.8)).toBeCloseTo(at(128.5, 128.5, [0, -1, 0], 0), 5);
  // Open ground, past the window, and with the map off the card.
  expect(at(20.5, 20.5, out, 0)).toBe(1);
  expect(at(-5, 128.5, up, 0)).toBe(1);
  frame[ROOF_AT + 3] = 0;
  expect(at(128.5, 128.5, up, 0)).toBe(1);
});

test("the map is made round the camera over frames, goes on the card whole once, and is made again when it should be", () => {
  const roof = new RoofMap();
  roof.palette = palette;
  const p = new FramePacket();
  p.tier = tierOf("high");
  let now = 0, sent = 0;
  const budget = { left: 1 << 20, spend: (bytes: number) => void (sent += bytes) };
  const frame = (x: number, z: number): void => {
    p.beginFrame();
    roof.update(p, budget, city, hf, none, x, z, (now += 1000 / 60), () => performance.now());
  };
  // Nothing is on the card until it is made, ROOF_STEPS slices a frame, which this small city takes in one.
  expect([p.roofSide, p.frame[ROOF_AT + 3], roof.whole]).toEqual([0, 0, false]);
  let frames = 0;
  while (roof.stats.made === 0 && frames < 1000) frame(128, 128), frames++;
  expect([frames, roof.whole]).toEqual([1, true]);
  expect([p.roofSide, p.frame[ROOF_AT], p.frame[ROOF_AT + 1], p.frame[ROOF_AT + 2], p.frame[ROOF_AT + 3], sent]).toEqual([ROOF_SIDE, -128, -128, ROOF_SIDE, 2, map.length]);
  expect(p.roofMap).toEqual(map);
  // The next frame sends nothing more and keeps it on.
  frame(130, 128);
  expect([p.roofMap.length, p.roofSide, p.frame[ROOF_AT], sent]).toEqual([0, ROOF_SIDE, -130, map.length]);
  // Short of ROOF_MOVE from its middle no new one is begun; past it one is, round the camera on the grid of 8 m.
  frame(128 + ROOF_MOVE - 1, 128);
  frame(128 + ROOF_MOVE - 1, 128);
  expect(roof.stats.made).toBe(1);
  frame(128 + ROOF_MOVE + 1, 128);
  expect([roof.stats.made, p.frame[ROOF_AT]]).toEqual([2, Math.round((128 + ROOF_MOVE + 1) / 8) * 8 - ROOF_SIDE / 2 - (128 + ROOF_MOVE + 1)]);
  // Pieces gone: made again where it is, but not again before ROOF_EVERY.
  roof.changed();
  frame(176, 128);
  while (roof.stats.made === 2 && frames < 3000) frame(176, 128), frames++;
  roof.changed();
  const made = roof.stats.made, since = now;
  for (let k = 0; k < 100 && now - since < ROOF_EVERY / 2; k++) frame(176, 128);
  expect(roof.stats.made).toBe(made);
  // After a lost context it goes on the card again.
  roof.reset();
  frame(176, 128);
  expect(p.roofMap.length).toBe(map.length);
});

test("the desktop tiers' lit programs read what stands overhead, a phone's and low poly's do not", () => {
  const roofs = (tier: (typeof TIERS)[number]): boolean[] => ["flat", "terrain", "surface"].map((name) => PROGRAMS[name]!(tier, "bc").defines.includes("#define ROOF\n"));
  expect(TIERS.map((t) => [t.name, roofs(t)])).toEqual([["lowpoly", [false, false, false]], ["medium", [true, true, true]], ["high", [true, true, true]], ["ultra", [true, true, true]]]);
  for (const t of TIERS) expect(roofs(forTouch(t, true))).toEqual([false, false, false]);
  for (const name of ["flat", "terrain", "surface"]) expect(PROGRAMS[name]!(tierOf("high"), "bc").fragment).toContain("roofOpen(vRel, ");
  // The ground's light is the ground's on statics and bodies, not on the ground itself.
  expect(["flat", "terrain", "surface"].map((name) => PROGRAMS[name]!(tierOf("high"), "bc").fragment.includes("  roofBounce(vRel, "))).toEqual([true, false, true]);
});

test("the ground's colour: its tint, a flat piece lying on it, or the sky table's grey with no colours", () => {
  expect([0, 1, 2].map((b) => cell(20, 20, b, 1))).toEqual([60, 60, 64]);
  expect([0, 1, 2].map((b) => cell(200, 20, b, 1))).toEqual([214, 190, 150]);
  expect([0, 1, 2].map((b) => cell(60, 60, b, 1))).toEqual([180, 180, 180]);
  const grey = bake(null);
  expect([0, 1, 2].map((b) => grey[((ROOF_SIDE + 20) * ROOF_SIDE + 200) * ROOF_BYTES + b]!)).toEqual([149, 149, 149]);
});

test("a face's light from the ground: the ground's colour it sees, the sun's part off where that is not lit, neutral where it should be", () => {
  const frame = new Float32Array(ROOF_AT + 4);
  frame.set([-100, -100, ROOF_SIDE, 2], ROOF_AT);
  const out = new Float64Array(4);
  const at = (x: number, z: number, n: readonly number[], over: number, lit = 1): number[] => {
    roofOpen(map, ROOF_SIDE, frame, x - 100, z - 100, n[0]!, n[1]!, n[2]!, over);
    roofBounce(out, map, ROOF_SIDE, frame, x - 100, z - 100, n[0]!, n[1]!, n[2]!, over, lit);
    return Array.from(out);
  };
  // A wall on the walk facing east sees the warm walk, brighter than the grey; one facing west the asphalt, darker.
  const walk = at(150.5, 20.5, [1, 0, 0], 1), road = at(122.5, 20.5, [-1, 0, 0], 1);
  expect(walk[0]!).toBeGreaterThan(walk[2]! + 0.1);
  expect(walk[1]!).toBeGreaterThan(1);
  expect(road.slice(0, 3).every((c) => c < 0.8)).toBe(true);
  expect(road[3]).toBe(1);
  // Under the slab a face's light from below is not also taken down by the roof's share: the colour is over what it kept.
  const kept = roofOpen(map, ROOF_SIDE, frame, 25.5, 28.5, 0, -1, 0, 2.5), under = at(125.5, 128.5, [0, -1, 0], 2.5);
  roofOpen(map, ROOF_SIDE, frame, 25.5, 28.5, 0, -1, 0, 2.5);
  expect(kept).toBeLessThan(0.6);
  expect(under[0]! * kept).toBeCloseTo(road[0]!, 1);
  // Under the slab's east edge a face turned down sees the walk past it, out toward the open side; deep under, the asphalt.
  const edge = at(131.5, 128.5, [0, -1, 0], 2.5)[0]! * ROOF_LAST[4]!, deep = at(125.5, 128.5, [0, -1, 0], 2.5)[0]! * ROOF_LAST[4]!;
  expect([edge > 1, deep < 1]).toEqual([true, true]);
  // The sun's share lit is what the shadows give, never under BOUNCE_LEAST.
  expect(at(150.5, 20.5, [1, 0, 0], 1, 0)[3]).toBeCloseTo(BOUNCE_LEAST, 12);
  expect(at(150.5, 20.5, [1, 0, 0], 1, 0.5)[3]).toBeCloseTo(BOUNCE_LEAST + (1 - BOUNCE_LEAST) * 0.5, 12);
  // A face up, the roof alone (fRoof.w 1) and past the window are neutral.
  expect(at(150.5, 20.5, [0, 1, 0], 1)).toEqual([1, 1, 1, 1]);
  frame[ROOF_AT + 3] = 1;
  expect(at(150.5, 20.5, [1, 0, 0], 1)).toEqual([1, 1, 1, 1]);
  frame[ROOF_AT + 3] = 2;
  expect(at(-20, 20.5, [1, 0, 0], 1)).toEqual([1, 1, 1, 1]);
});

test("the light from below loses the sun's part of the ground's light where the ground is not lit, and takes its colour; neutral, it is the sky table's", () => {
  // The sky table's ground is the one the lit tiers take its sun's part from.
  expect([skyBuild.GROUND, skyBuild.OPEN]).toEqual([GROUND, OPEN]);
  expect(BOUNCE_SUN).toBeCloseTo(GROUND / (1 - GROUND * (1 - OPEN)), 12);
  const frame = new Float32Array(FRAME.skySide + 4);
  frame.set([0.2, 0.3, 0.4], FRAME.skyBelow);
  frame.set([1, 1.1, 1.2], FRAME.skyAbove);
  frame.set([2, 1.9, 1.7], FRAME.sunColor);
  frame[FRAME.sun + 1] = 0.5;
  const out = new Float64Array(3);
  skyOn(out, frame, -1);
  expect(Array.from(out)).toEqual([0.2, 0.3, 0.4].map(Math.fround));
  bounce.set([1, 1, 1, 0]);
  skyOn(out, frame, -1);
  for (let c = 0; c < 3; c++) expect(out[c]!).toBeCloseTo(Math.fround([0.2, 0.3, 0.4][c]!) - Math.fround([2, 1.9, 1.7][c]!) * BOUNCE_SUN * 0.5, 6);
  bounce.set([2, 1, 0.5, 1]);
  skyOn(out, frame, -1);
  for (let c = 0; c < 3; c++) expect(out[c]!).toBeCloseTo(Math.fround([0.2, 0.3, 0.4][c]!) * [2, 1, 0.5][c]!, 6);
  // A face up takes none of it.
  skyOn(out, frame, 1);
  expect(Array.from(out)).toEqual([1, 1.1, 1.2].map(Math.fround));
  bounce.fill(1);
});

test("the scene makes the map round the camera, and the rasterizer, the reference for light, darkens the ground under the slab alone", () => {
  // A plate held up at 3 m over open ground, the camera 16 m off looking at the ground under it.
  const w = cityWorld({ chunks: 8, statics: [{ kind: FLOOR, x: 256, y: 3, z: 256, yaw: 0 }], tier: tierOf("high"), width: 320, height: 180 });
  w.scene.plainSky = true;
  w.scene.hour = 12;
  [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [256, 1.6, 240, 0, -0.18];
  for (let k = 0; k < 200 && (w.scene.farShadow?.roof?.stats.made ?? 0) === 0; k++) {
    w.scene.now += 1000 / 60;
    const p = w.scene.build(w.cam, null);
    p.drawCount = p.tileCount = 0;
    w.raster.render(p);
  }
  expect(w.scene.farShadow!.roof!.stats.made).toBe(1);
  const p = w.frame(true);
  expect([p.frame[ROOF_AT + 2], p.frame[ROOF_AT + 3]]).toEqual([ROOF_SIDE, 2]);
  const roofed = Uint8Array.from(w.raster.color);
  p.frame[ROOF_AT + 3] = 0;
  w.raster.render(p);
  const plain = Uint8Array.from(w.raster.color);
  const sum = (c: Uint8Array, k: number): number => c[k * 4]! + c[k * 4 + 1]! + c[k * 4 + 2]!;
  let under = 0, darker = 0, open = 0, changed = 0;
  const dir = [0, 0, 0];
  for (let k = 0; k < w.W * w.H; k++) {
    if (w.raster.pickKind[k] !== PICK_TERRAIN) continue;
    w.cam.ray(((k % w.W) + 0.5) / w.W, (Math.floor(k / w.W) + 0.5) / w.H, dir);
    if (dir[1]! >= 0) continue;
    const t = -w.cam.y / dir[1]!;
    const gx = w.cam.x + dir[0]! * t, gz = w.cam.z + dir[2]! * t;
    if (Math.abs(gx - 256) < 3 && gz > 253 && gz < 259) {
      under++;
      if (sum(plain, k) - sum(roofed, k) >= 6) darker++;
    } else if (gz < 249) {
      open++;
      if (sum(plain, k) !== sum(roofed, k)) changed++;
    }
  }
  expect(under).toBeGreaterThan(200);
  expect(open).toBeGreaterThan(2000);
  expect([darker, changed]).toEqual([under, 0]);
});
