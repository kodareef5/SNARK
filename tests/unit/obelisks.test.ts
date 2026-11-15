// An obelisk as a map sets it down, and a save made before its map had obelisks given them as it loads (shared/world/obelisks.ts).
import { expect, test } from "bun:test";
import type { MapData } from "../../shared/world/mapfile.ts";
import { OBELISK, OBELISK_PIECES, TRAVEL_TERMINAL, obeliskStatics, restoreObelisks } from "../../shared/world/obelisks.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();

test("an obelisk stands on the ground, three pieces high, with its terminal on the ground a step in front of it along its facing", () => {
  const ground = (x: number, z: number): number => x * 0.01 + z * 0.02;
  const pieces = obeliskStatics(reg, { name: "north", x: 300, z: 200, yaw: 16384 }, ground);
  expect(pieces.map((p) => p.kind)).toEqual([...Array<string>(OBELISK_PIECES).fill(OBELISK), TRAVEL_TERMINAL]);
  const [low, , top, terminal] = pieces;
  expect([low!.y, top!.y + 15]).toEqual([ground(300, 200) + 15, ground(300, 200) + 90]);
  // A quarter turn faces +x: the terminal stands 3 + 1.5 + 0.3 m out that way, on the ground there.
  expect([terminal!.x, terminal!.z, terminal!.y].map((v) => Math.round(v * 1000) / 1000)).toEqual([304.8, 200, Math.round((ground(304.8, 200) + 0.6) * 1000) / 1000]);
});

test("a save without its map's obelisks gets them as it loads, once", () => {
  const dims = { chunksX: 8, chunksZ: 8 };
  const statics = obeliskStatics(reg, { name: "plaza", x: 290, z: 230, yaw: 0 }, () => 0);
  const map = { statics } as unknown as MapData;
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  expect(restoreObelisks(map, structs, reg)).toBe(OBELISK_PIECES + 1);
  expect(restoreObelisks(map, structs, reg)).toBe(0);
  expect(structs.count).toBe(OBELISK_PIECES + 1);
});
