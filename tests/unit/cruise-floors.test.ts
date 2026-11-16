import { expect, test } from "bun:test";
import { cruiseFootprintContains, cruisePolygonSide, type CruiseDeck, type CruiseRoom } from "../../content/landmarks/cruise-layout.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { castWorld, HIT_STRUCTURE } from "../../shared/world/ray.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { cruiseRoomFloors } from "../fixtures/cruise-floors.ts";

const deck: CruiseDeck = { id: "3", index: 1, floorY: 6.4, ceilingY: 9.5, outlines: [], voids: [] };
const room: CruiseRoom = { id: "test room", node: "target", label: "room", deck: "3", section: "test",
  bounds: { min: [-4, 6.4, -3], max: [4, 9.5, 3] }, entry: [-4, 6.4, 0], routeTarget: [-1, 6.4, 0] };
const point = (p: readonly number[]) => [32 + p[0]!, p[1]!, 32 + p[2]!];

test("room floor acceptance rejects an unsupported outer side even when entry and target have floors", () => {
  const dims = { chunksX: 1, chunksZ: 1 }, hf = new Heightfield(dims, 2, 0, 1 / 256);
  const structs = new StructureStore(dims, Float32Array.of(0, 2.5), Float32Array.of(0, .12), Float32Array.of(0, 3));
  structs.add(1, 30.5, 6.28, 32, 0, 0, 1); // Room expects X[-4,4], actual floor only X[-4,1].
  const world = { hf, structs };
  for (const p of [room.entry, room.routeTarget]) { const at = point(p); expect(castWorld(world, at[0]!, 6.44, at[2]!, 0, -1, 0, .08)).toBe(HIT_STRUCTURE); }
  const failed = cruiseRoomFloors(world, [room], [deck], point)[0]!;
  expect(failed.samples).toBeGreaterThan(150); expect(failed.missing).toBeGreaterThan(0);
  expect(failed.witnesses.every(p => p[0]! > 1)).toBe(true);
  structs.add(1, 35.5, 6.28, 32, 0, 0, 1);
  expect(cruiseRoomFloors(world, [room], [deck], point)[0]!.missing).toBe(0);
});

test("occupied plans preserve disconnected supported pieces and explicit holes without hiding unmarked gaps", () => {
  const footprint = { polygons: [[[-4, -3], [4, -3], [4, 3], [-4, 3]]], holes: [[[-1, -3], [1, -3], [1, 3], [-1, 3]]] };
  expect(cruisePolygonSide(4, 0, footprint.polygons[0]!)).toBe(0);
  expect(cruiseFootprintContains(footprint, 0, 0)).toBe(false);
  expect(cruiseFootprintContains(footprint, 2, 0)).toBe(true);
  const dims = { chunksX: 1, chunksZ: 1 }, hf = new Heightfield(dims, 2, 0, 1 / 256);
  const structs = new StructureStore(dims, Float32Array.of(0, 1.5), Float32Array.of(0, .12), Float32Array.of(0, 3));
  for (const x of [29.5, 34.5]) structs.add(1, x, 6.28, 32, 0, 0, 1);
  const world = { hf, structs };
  expect(cruiseRoomFloors(world, [room], [deck], point)[0]!.missing).toBeGreaterThan(0);
  expect(cruiseRoomFloors(world, [{ ...room, footprint }], [deck], point)[0]!.missing).toBe(0);
  const split = { polygons: [[[-4, -3], [-1, -3], [-1, 3], [-4, 3]], [[1, -3], [4, -3], [4, 3], [1, 3]]], holes: [] };
  expect(cruiseRoomFloors(world, [{ ...room, footprint: split }], [deck], point)[0]!.missing).toBe(0);
  const voidDeck = { ...deck, voids: [{ id: "atrium", kind: "atrium", polygon: footprint.holes[0]! }] };
  const result = cruiseRoomFloors(world, [room], [voidDeck], point)[0]!;
  expect(result.missing).toBe(0); expect(result.declaredVoids).toBeGreaterThan(0);
});
