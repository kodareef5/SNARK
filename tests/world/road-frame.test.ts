import { expect, test } from "bun:test";
import { ROAD_AGAINST, ROAD_ONE_WAY, ROAD_WEAR_SHIFT, roadAlong, roadSamples } from "../../shared/world/roadframe.ts";
import { roadFrame } from "../../tools/mapworld/road-frame.ts";
import type { Piece, Segment } from "../../tools/mapworld/street-graph.ts";

const piece = (more: Partial<Piece>): Piece => ({ id: "p", seed: 0, mtfcc: "S1400", highway: "residential", name: null, lanes: 2, half: 5, oneway: 0, sidewalk: null, bridge: false, tunnel: false, maxspeed: null, lit: null, parking: [null, null], ...more });
const along = (line: number, ax: number, az: number, bx: number, bz: number, half: number): Segment => ({ ax, az, bx, bz, half, mtfcc: line === 3 ? "S1710" : "S1400", line });

test("the frame holds a carriageway's offset, distance along, half width and lanes at every 4 m cell near it, the widest where two cross, and none on a bridge or a path", () => {
  const pieces = [
    piece({}),
    piece({ highway: "primary", lanes: 4, half: 7, oneway: -1 }),
    piece({ bridge: true }),
    piece({ highway: "footway" }),
  ];
  // A street along x in two stretches, an avenue across it along z, a bridge and a footway, on a map of 400 m a side whose first sample is lattice (0, 0).
  const segments = [along(0, 100, 200, 200, 200, 5), along(0, 200, 200, 300, 200, 5), along(1, 200, 100, 200, 300, 7), along(2, 100, 260, 300, 260, 5), along(3, 100, 120, 160, 120, 5)];
  const frame = roadFrame({ segments, pieces }, 201, 201, 0, 0);
  const cells = roadSamples(201);
  const at = (x: number, z: number): number[] => {
    const k = (z / 4) * cells + x / 4;
    return [frame.across[k]!, frame.along[k]!, frame.half[k]!, frame.lanes[k]!];
  };
  const street = 2 | (2 << ROAD_WEAR_SHIFT);
  // On the street's centre line, 50 m along it; 4 m to its left; and past its verge, none.
  expect(at(148, 200)).toEqual([128, roadAlong(48), 40, street]);
  expect(at(148, 204)[0]).toBe(128 + 32);
  expect(at(148, 196)[0]).toBe(128 - 32);
  expect(at(148, 212)).toEqual([0, 0, 0, 0]);
  // "Along" runs on from the street's first stretch into its second, wrapping every 64 m.
  expect(at(252, 200)[1]).toBe(roadAlong(152));
  // Where the two cross, the wider avenue's: one way against how it is drawn, and a primary road's wear.
  expect(at(200, 200)).toEqual([128, roadAlong(100), 56, 4 | ROAD_ONE_WAY | ROAD_AGAINST | (5 << ROAD_WEAR_SHIFT)]);
  // No frame on the bridge's deck or the footway.
  expect(at(148, 260)[0]).toBe(0);
  expect(at(140, 120)[0]).toBe(0);
});
