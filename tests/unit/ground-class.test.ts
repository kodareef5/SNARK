// The ground's classes a wheel feels (MapData.ground, D811): carried a cell each two samples a side through a map's ground
// parts and back, read where a wheel stands, and plain ground on a map that gives none.

import { expect, test } from "bun:test";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StagedMap } from "../../client/core/mapload.ts";
import { mapHeightfield, parseMap, readHead, readPart, writeMap } from "../../shared/world/mapfile.ts";
import { HIT_STRUCTURE, HIT_TERRAIN } from "../../shared/world/ray.ts";
import { ASPHALT, GROUND_CLASS, MUD, OFFROAD, SAND, vehicleSurfaceAt } from "../../shared/world/vehicle-surface.ts";
import { wideMap } from "../fixtures/map.ts";

const base = wideMap();
const [gx, gz] = [(base.dims.chunksX * CHUNK_SIZE) / TERRAIN_CELL / 2 + 1, (base.dims.chunksZ * CHUNK_SIZE) / TERRAIN_CELL / 2 + 1];
/** A class by cell that differs across every sector's edge, so a part put in the wrong place shows. */
const classOf = (i: number, j: number): number => (i * 7 + j * 3 + ((i >> 7) ^ (j >> 5))) % 6;
const ground = Uint8Array.from({ length: gx * gz }, (_, k) => classOf(k % gx, Math.floor(k / gx)));

test("a map's ground classes come back from its file whole, a cell each two samples a side across every sector", () => {
  const back = parseMap(writeMap({ ...base, ground }));
  expect(back.ground).toEqual(ground);
  // The same map with none comes back with none, and its file is the one it always was.
  expect(parseMap(writeMap(base)).ground).toBeUndefined();
});

test("the page holds the classes as its sectors' ground comes, so its car reads the surface the server's does", () => {
  const file = writeMap({ ...base, ground });
  const head = readHead(file);
  const staged = new StagedMap(head);
  // Every part but the head, in a scrambled order; before a sector comes its cells read as plain ground.
  const parts = head.parts.filter((p) => p.kind !== "statics" && p.kind !== "tops");
  for (const [k, p] of [...parts].sort((a, b) => ((a.at * 7919) % 101) - ((b.at * 7919) % 101)).entries()) {
    staged.take(readPart(head, p, file.subarray(p.at, p.at + p.length)) as never);
    if (k === 0) expect(staged.hf.ground.length).toBe(ground.length);
  }
  expect(staged.hf.ground).toEqual(ground);
  const server = { hf: mapHeightfield(parseMap(file)) } as CollisionWorld;
  const page = { hf: staged.hf } as CollisionWorld;
  for (const [x, z] of [[0, 0], [20, 36], [512, 128], [2800, 600], [4000, 1200]] as const) expect(vehicleSurfaceAt(page, HIT_TERRAIN, 0, x, z)).toBe(vehicleSurfaceAt(server, HIT_TERRAIN, 0, x, z));
});

test("a wheel on the terrain reads the class where it stands; one on a structure, or on a map with none, does not", () => {
  const map = parseMap(writeMap({ ...base, ground }));
  const world = { hf: mapHeightfield(map) } as CollisionWorld;
  const SURFACES = [OFFROAD, ASPHALT, undefined, undefined, SAND, MUD];
  for (const [i, j] of [[0, 0], [5, 9], [128, 32], [700, 150], [gx - 1, gz - 1]] as const) {
    const want = classOf(i, j);
    // The cell's own samples and the one beside it in each direction within the cell all read it.
    for (const [x, z] of [[i * 4, j * 4], [i * 4 + 1.9, j * 4 + 1.9]] as const) {
      if (x > base.dims.chunksX * CHUNK_SIZE || z > base.dims.chunksZ * CHUNK_SIZE) continue;
      expect(world.hf.groundClassAt(x, z)).toBe(want);
      if (SURFACES[want]) expect(vehicleSurfaceAt(world, HIT_TERRAIN, 0, x, z)).toBe(SURFACES[want]!);
    }
  }
  expect(GROUND_CLASS.ASPHALT).toBe(1);
  // Off the map, plain ground; with no place given, as a caller that knows none, plain ground.
  expect(world.hf.groundClassAt(-50, 10)).toBe(GROUND_CLASS.GROUND);
  expect(vehicleSurfaceAt(world, HIT_TERRAIN, 0)).toBe(OFFROAD);
  const bare = { hf: mapHeightfield(parseMap(writeMap(base))) } as CollisionWorld;
  expect(vehicleSurfaceAt(bare, HIT_TERRAIN, 0, 100, 100)).toBe(OFFROAD);
  // A structure's surface is its kind's, never the ground's under it.
  const onPiece = { hf: world.hf, structs: { chunks: [], parts: {} } } as unknown as CollisionWorld;
  expect(vehicleSurfaceAt(onPiece, HIT_STRUCTURE, 0, 0, 0)).toBe(OFFROAD);
});
