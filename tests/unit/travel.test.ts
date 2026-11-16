import { expect, test } from "bun:test";
import { PART_FLOATS, poseTravelling, travellingOf } from "../../client/core/render/travel.ts";
import type { Def, TravelFacet } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { TRAVEL_STEPS, readTravelBytes, readTravels, thrown, travelBytes, travelProgress, writeTravels } from "../../shared/sim/travel.ts";
import { MapStatics } from "../../shared/world/mapfile.ts";

const facet: TravelFacet = {
  seconds: 18,
  say: ["set the sails", "strike the sails"],
  parts: [
    // A sheet that stands 30 m tall set and a fiftieth of that struck, and a spar that swings down a quarter turn about x.
    { mesh: "test:sheet", from: { at: [1, 2, 3], scale: [1, 0.02, 1] }, to: { at: [1, 2, 3] } },
    { mesh: "test:spar", from: { at: [0, 4, 0], turn: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] }, to: { at: [0, 30, 0] } },
  ],
};
const defs: Def[] = [
  { type: "shape", id: "test:control_shape", role: "thing", boxes: [{ at: [0, 0.5, 0], half: [0.4, 0.5, 0.4] }] },
  { type: "structure", class: "static", id: "test:control", mesh: "shape", shape: "test:control_shape", half: [0.4, 1, 0.4], color: 3, hp: 100, travel: facet },
];

test("a throw goes on from where the static stands toward the state it was not going to, alike from its record's six bytes and its row", () => {
  const ticks = 18 * TICK_RATE;
  const first = thrown(null, ticks, 100);
  expect(first).toEqual({ from: 0, to: 1, at: 100 });
  expect(travelProgress(first, ticks, 100 + ticks / 2)).toBeCloseTo(0.5, 6);
  expect(travelProgress(first, ticks, 100 + ticks * 2)).toBe(1);
  // Turned back a third of the way, it comes back from there, and is at rest at its first state a third of a travel later.
  const back = thrown(first, ticks, 100 + ticks / 3);
  expect(back.to).toBe(0);
  expect(back.from / TRAVEL_STEPS).toBeCloseTo(1 / 3, 4);
  expect(travelProgress(back, ticks, back.at + ticks / 3 + 1)).toBe(0);
  expect(readTravelBytes(travelBytes(back))).toEqual(back);
  const w = new BitWriter(64);
  writeTravels(w, new Map([[0x00030007, back], [5, first]]));
  expect(w.bytes().length).toBe(1 + 2 * 10);
  expect(readTravels(new BitReader(w.bytes()))).toEqual(new Map([[0x00030007, back], [5, first]]));
  expect(readTravels(new BitReader(w.bytes().subarray(0, 15)))).toBeNull();
});

test("content refuses a travel that is not a public static's, one too long, a part too far and a turn that is no rotation", () => {
  expect(compileContent(defs).errors).toEqual([]);
  const bad = (t: Partial<TravelFacet>, extra: object = {}): string[] => compileContent([defs[0]!, { ...defs[1]!, travel: { ...facet, ...t }, ...extra } as Def]).errors;
  expect(bad({ seconds: 900 })).toEqual(["test:control: travel takes 0.5 to 600 seconds"]);
  expect(bad({ parts: [{ ...facet.parts[0]!, to: { at: [0, 200, 0] } }] })).toHaveLength(1);
  expect(bad({ parts: [{ ...facet.parts[1]!, from: { at: [0, 0, 0], turn: [1, 1, 0, 0] } }] })).toHaveLength(1);
  expect(bad({}, { material: "core:mat_wood" }).some((e) => e.includes("nothing harms"))).toBe(true);
});

test("a part's pose is its first placement at rest at first, its second set, eased between, turned with its static, and posed again only when it moves", () => {
  const reg = compileContent(defs).registry!;
  const quarter = 16384;
  const statics = MapStatics.of({ chunksX: 2, chunksZ: 2 }, [{ kind: "test:control", x: 70, y: 1, z: 10, yaw: quarter }]);
  const [t] = travellingOf(reg, statics);
  expect(t!.ref).toBe(1 * 65536);
  poseTravelling(t!, undefined, 0);
  const sheet = (k: number): number => t!.pose[k]!, spar = (k: number): number => t!.pose[PART_FLOATS + k]!;
  // A quarter turn takes the static's +x to -z and its +z to +x, as a rigid instance is turned.
  expect([sheet(3), sheet(7), sheet(11)].map((v) => +v.toFixed(5))).toEqual([3, 2, -1]);
  expect(sheet(5)).toBeCloseTo(0.02, 6);
  // Its y is turned a quarter about x: its up is the static's z, which the yaw turns to the world's x.
  expect([spar(0), spar(1), spar(2), spar(4), spar(5), spar(6), spar(7)].map((v) => +v.toFixed(5))).toEqual([0, -1, 0, 0, 0, 1, 4]);
  const state = { from: 0, to: 1 as const, at: 0 };
  poseTravelling(t!, state, 18 * TICK_RATE * 4);
  expect(t!.progress).toBe(1);
  expect(sheet(5)).toBeCloseTo(1, 6);
  expect([spar(4), spar(5), spar(6), spar(7)].map((v) => +v.toFixed(5))).toEqual([0, 1, 0, 30]);
  // Half way the ease is half way too, and the spar's turn is a rotation still.
  poseTravelling(t!, state, 9 * TICK_RATE);
  expect(spar(7)).toBeCloseTo(17, 4);
  expect(Math.hypot(spar(4), spar(5), spar(6))).toBeCloseTo(1, 5);
  // At rest it is not posed again: a pose written over stays as it is.
  poseTravelling(t!, state, 18 * TICK_RATE * 4);
  t!.pose[5] = 7;
  poseTravelling(t!, state, 18 * TICK_RATE * 5);
  expect(sheet(5)).toBe(7);
});
