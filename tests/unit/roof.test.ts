// What stands overhead (client/core/render/roof.ts): a slab 2.8 m over open ground roofs the cells under it with its
// underside's height, spread two cells past its edge; a face up keeps less of the sky deep under it than at its edge,
// and a face at its edge turned out keeps more than one turned in; a piece standing on the ground roofs nothing; a point
// over the slab, past the window or off the card keeps all of it, and none keeps less than ROOF_LEAST; the map is made
// round the camera over frames and goes on the card whole, again once the camera has gone far enough or pieces have gone,
// but not more often than it should; and only the desktop tiers' lit programs read it.

import { expect, test } from "bun:test";
import { TIERS, forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { FramePacket, ROOF_AT } from "../../client/core/render/packet.ts";
import { PROGRAMS } from "../../client/core/render/programs.ts";
import { ROOF_BYTES, ROOF_EVERY, ROOF_LEAST, ROOF_MOVE, ROOF_SIDE, RoofMap, roofOpen, roofSteps } from "../../client/core/render/roof.ts";
import type { MapDims } from "../../shared/coords.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { FLOOR } from "../fixtures/cityworld.ts";
import { farRegistry } from "../fixtures/farworld.ts";

const dims: MapDims = { chunksX: 4, chunksZ: 4 };
const hf = new Heightfield(dims, TERRAIN_CELL, 0, 0.01);
/** A floor plate 8 m a side held up at 3 m, its underside at 2.8 m, and another lying on the ground. */
const city = new CityStatics(dims, [{ kind: FLOOR, x: 128, y: 3, z: 128, yaw: 0 }, { kind: FLOOR, x: 60, y: 0.2, z: 60, yaw: 0 }], farRegistry());
const none = (): null => null;

function bake(): Uint8Array {
  const out = new Uint8Array(ROOF_SIDE * ROOF_SIDE * ROOF_BYTES);
  const steps = roofSteps(city, hf, none, 0, 0, ROOF_SIDE, out);
  while (!steps.next().done);
  return out;
}
const map = bake();
const cell = (x: number, z: number, b: number): number => map[(z * ROOF_SIDE + x) * ROOF_BYTES + b]!;

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
  // A face turned down keeps what a face up does, and a point well over the underside keeps it all.
  expect(at(128.5, 128.5, [0, -1, 0], 1)).toBeCloseTo(at(128.5, 128.5, up, 1), 5);
  expect(at(128.5, 128.5, up, 3.2)).toBe(1);
  // Open ground, past the window, and with the map off the card.
  expect(at(20.5, 20.5, out, 0)).toBe(1);
  expect(at(-5, 128.5, up, 0)).toBe(1);
  frame[ROOF_AT + 3] = 0;
  expect(at(128.5, 128.5, up, 0)).toBe(1);
});

test("the map is made round the camera over frames, goes on the card whole once, and is made again when it should be", () => {
  const roof = new RoofMap();
  const p = new FramePacket();
  p.tier = tierOf("high");
  let now = 0, sent = 0;
  const clock = (): number => (now += 0.5);
  const budget = { left: 1 << 20, spend: (bytes: number) => void (sent += bytes) };
  const frame = (x: number, z: number): void => {
    p.beginFrame();
    roof.update(p, budget, city, hf, none, x, z, clock);
  };
  frame(128, 128);
  // The first frame begins it and puts nothing on the card.
  expect([p.roofSide, p.frame[ROOF_AT + 3], roof.stats.made]).toEqual([0, 0, 0]);
  let frames = 1;
  while (roof.stats.made === 0 && frames < 1000) frame(128, 128), frames++;
  expect(frames).toBeGreaterThan(1);
  expect([p.roofSide, p.frame[ROOF_AT], p.frame[ROOF_AT + 1], p.frame[ROOF_AT + 2], p.frame[ROOF_AT + 3], sent]).toEqual([ROOF_SIDE, -128, -128, ROOF_SIDE, 1, ROOF_SIDE * ROOF_SIDE * ROOF_BYTES]);
  expect(p.roofMap).toEqual(map);
  // The next frame sends nothing more and keeps it on.
  frame(130, 128);
  expect([p.roofMap.length, p.roofSide, p.frame[ROOF_AT], sent]).toEqual([0, ROOF_SIDE, -130, ROOF_SIDE * ROOF_SIDE * ROOF_BYTES]);
  // Short of ROOF_MOVE from its middle no new one is begun; past it one is, the old one shown until it is made.
  frame(128 + ROOF_MOVE - 1, 128);
  frame(128 + ROOF_MOVE - 1, 128);
  expect(roof.stats.made).toBe(1);
  frame(128 + ROOF_MOVE + 1, 128);
  expect(p.frame[ROOF_AT]).toBe(-(128 + ROOF_MOVE + 1));
  while (roof.stats.made === 1 && frames < 2000) frame(128 + ROOF_MOVE + 1, 128), frames++;
  expect(p.frame[ROOF_AT]).toBe(Math.round((128 + ROOF_MOVE + 1) / 8) * 8 - ROOF_SIDE / 2 - (128 + ROOF_MOVE + 1));
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
  expect(p.roofMap.length).toBe(ROOF_SIDE * ROOF_SIDE * ROOF_BYTES);
});

test("the desktop tiers' lit programs read what stands overhead, a phone's and low poly's do not", () => {
  const roofs = (tier: (typeof TIERS)[number]): boolean[] => ["flat", "terrain", "surface"].map((name) => PROGRAMS[name]!(tier, "bc").defines.includes("#define ROOF\n"));
  expect(TIERS.map((t) => [t.name, roofs(t)])).toEqual([["lowpoly", [false, false, false]], ["medium", [true, true, true]], ["high", [true, true, true]], ["ultra", [true, true, true]]]);
  for (const t of TIERS) expect(roofs(forTouch(t, true))).toEqual([false, false, false]);
  for (const name of ["flat", "terrain", "surface"]) expect(PROGRAMS[name]!(tierOf("high"), "bc").fragment).toContain("roofOpen(vRel, ");
});
