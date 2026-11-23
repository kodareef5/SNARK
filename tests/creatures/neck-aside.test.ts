// A dinosaur whose head comes up to a wall turns its neck aside from it (shared/anim/creature.ts), from its pose and the
// walls alone, so the server's bites and hits find the head where every client draws it.
import { expect } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { poseCreatureOn, speciesAnim } from "../../shared/anim/creature.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { Solved, boneToModel } from "../../shared/anim/skeleton.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";

const reg = compileContent(CORE_CONTENT).registry!;

function world(wall: boolean) {
  const dims = { chunksX: 2, chunksZ: 2 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  if (wall) {
    // Two walls stacked across +Z just ahead of a rex's head, 4.9 m up and 4.4 m ahead of it at (40, 40) facing +Z.
    const kind = reg.index.get("core:wall_stone")!;
    for (const y of [1, 3]) structs.add(kind, 39.5, reg.halfY[kind]! * y, 45.2, 0, 1, 10000);
  }
  return { hf, structs };
}

/** Where the rex's head is, posed at (40, 0, 40) facing +Z with or without the wall. */
function head(withWall: boolean) {
  const rigs = buildRigs(corePack().header.rigs, corePack().clips);
  const i = reg.index.get("core:rex")!, def = reg.defs[i] as { mesh: string }, rig = rigs.get(def.mesh)!;
  const anim = speciesAnim(reg, i, rig), st = new AnimState(), solved = new Solved(rig.bones), p = new Float64Array(3);
  poseCreatureOn(anim, st, 100, world(withWall), 40, 0, 40, 0, 1, null, solved);
  const h = rig.sections.head * 3;
  boneToModel(solved, rig.sections.head, (rig.capA[h]! + rig.capB[h]!) / 2, (rig.capA[h + 1]! + rig.capB[h + 1]!) / 2, (rig.capA[h + 2]! + rig.capB[h + 2]!) / 2, p);
  return { x: 40 + p[0]!, y: p[1]!, z: 40 + p[2]!, rig };
}

artTest("a rex's head near a wall turns aside from it, and none turns with no wall near", () => {
  const open = head(false), walled = head(true);
  // Straight ahead of a head that leans right: turned, it goes further right and back from the wall.
  expect(open.rig.sections.head).toBeGreaterThanOrEqual(0);
  expect(walled.x).toBeLessThan(open.x - 0.1);
  expect(walled.z).toBeLessThan(open.z);
  // A second pose with no wall is the first again.
  expect(head(false)).toEqual(open);
});
