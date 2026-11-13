// Small deterministic worlds for tests.

import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import type { MapDims } from "../../shared/coords.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { buildProvingHeightfield, populateProving, PROVING_DIMS } from "../../shared/world/proving.ts";
import { StructureStore } from "../../shared/world/structures.ts";

export interface TestWorld extends CollisionWorld {
  readonly dims: MapDims;
  readonly reg: Registry;
  kind(id: string): number;
}

export function coreRegistry(): Registry {
  const { registry, errors } = compileContent(CORE_CONTENT);
  if (!registry) throw new Error(errors.join("\n"));
  return registry;
}

function wrap(dims: MapDims, hf: Heightfield, reg: Registry): TestWorld {
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ);
  return { dims, hf, structs, reg, kind: (id) => reg.index.get(id)! };
}

/** Flat ground at y = 0. */
export function flatWorld(chunks = 2): TestWorld {
  const dims = { chunksX: chunks, chunksZ: chunks };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  return wrap(dims, hf, coreRegistry());
}

export function provingWorld(): TestWorld {
  const reg = coreRegistry();
  const w = wrap(PROVING_DIMS, buildProvingHeightfield(), reg);
  populateProving(w.structs, w.hf, reg);
  return w;
}

/**
 * A sealed 6 m room centred on (cx, cz): four 0.2 m walls and a ceiling. Returns
 * the interior bounds a capsule centre can legally occupy.
 */
export function sealedRoom(w: TestWorld, cx: number, cz: number): { minX: number; maxX: number; minZ: number; maxZ: number; maxY: number } {
  const wall = w.kind("core:wall");
  const ceiling = w.kind("core:ceiling");
  const Q = 16384;
  for (const o of [-1.5, 1.5]) {
    w.structs.add(wall, cx + o, 1.5, cz - 3, 0, 0, 1);
    w.structs.add(wall, cx + o, 1.5, cz + 3, 0, 0, 1);
    w.structs.add(wall, cx - 3, 1.5, cz + o, Q, 0, 1);
    w.structs.add(wall, cx + 3, 1.5, cz + o, Q, 0, 1);
    for (const p of [-1.5, 1.5]) w.structs.add(ceiling, cx + o, 3.1, cz + p, 0, 0, 1);
  }
  return { minX: cx - 2.9, maxX: cx + 2.9, minZ: cz - 2.9, maxZ: cz + 2.9, maxY: 3 };
}
