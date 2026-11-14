import { expect, test } from "bun:test";
import { createMapWorld, provingFile } from "../../server/world.ts";
import { chunkCount } from "../../shared/coords.ts";
import { parseMap } from "../../shared/world/mapfile.ts";
import type { NodeSpot } from "../../shared/world/nodes.ts";
import { PROVING_DIMS, PROVING_ID, PROVING_SPAWNS, buildProvingHeightfield, populateProving, provingNodes } from "../../shared/world/proving.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { simHash } from "../../tools/simhash.ts";
import { coreRegistry } from "../fixtures/world.ts";

test("the proving ground loaded from its file is the one its functions build: every height, piece and node slot, and the same simulation", () => {
  const reg = coreRegistry();
  const world = createMapWorld(reg, parseMap(provingFile(reg)));
  const hf = buildProvingHeightfield();
  expect([world.mapId, world.dims, world.spawn, world.spawns]).toEqual([PROVING_ID, PROVING_DIMS, PROVING_SPAWNS[0]!, PROVING_SPAWNS]);
  expect([world.hf.cell, world.hf.minY, world.hf.stepY, world.hf.seaLevel]).toEqual([hf.cell, hf.minY, hf.stepY, hf.seaLevel]);
  expect(world.hf.heights).toEqual(hf.heights);
  expect(world.hf.tint).toEqual(hf.tint);

  // The tables must match slot for slot, since a piece is known by its chunk and slot.
  const structs = new StructureStore(PROVING_DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  populateProving(structs, hf, reg);
  expect(world.structs.count).toBe(structs.count);
  structs.chunks.forEach((t, chunk) => {
    const u = world.structs.chunks[chunk];
    if (!t) return expect(u ?? null).toBeNull();
    expect([u!.version, u!.high, u!.live]).toEqual([t.version, t.high, t.live]);
    for (const col of ["kind", "x", "y", "z", "yaw", "owner", "hp", "mod"] as const) expect(u![col].subarray(0, t.high)).toEqual(t[col].subarray(0, t.high));
  });

  const ours = world.nodeField!.source;
  const theirs = provingNodes(hf, reg);
  expect(ours.perChunk).toBe(theirs.perChunk);
  const a: NodeSpot = { kind: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const b: NodeSpot = { kind: 0, x: 0, y: 0, z: 0, yaw: 0 };
  let standing = 0;
  let differ = 0;
  for (let chunk = 0; chunk < chunkCount(PROVING_DIMS); chunk++) {
    for (let i = 0; i < theirs.perChunk; i++) {
      ours.at(chunk, i, a);
      theirs.at(chunk, i, b);
      if (a.kind !== b.kind || (a.kind !== 0 && (a.x !== b.x || a.y !== b.y || a.z !== b.z || a.yaw !== b.yaw))) differ++;
      if (a.kind !== 0) standing++;
    }
  }
  expect([differ, standing > 2000]).toEqual([0, true]);

  expect(simHash(600, reg, world)).toBe(simHash(600, reg));
});
