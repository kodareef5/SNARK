// Sloped and three-sided pieces made of convex parts: a ramp wedge, a triangle on 60 degree axes and a sloped roof slab. They
// are defined with the scenario that hashes them (shared/sim/scenarios.ts). The game's content has none yet.

import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { HULL_PIECES } from "../../shared/sim/scenarios.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import type { TestWorld } from "./world.ts";

export { ROOF_RISE, ROOF_THICK, TRIANGLE_HALF } from "../../shared/sim/scenarios.ts";

export function hullRegistry(): Registry {
  const { registry, errors } = compileContent([...CORE_CONTENT, ...HULL_PIECES]);
  if (!registry) throw new Error(errors.join("\n"));
  return registry;
}

/** Flat ground at y = 0, with the core pieces and these. */
export function hullWorld(chunks = 4): TestWorld {
  const reg = hullRegistry();
  const dims = { chunksX: chunks, chunksZ: chunks };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 0);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  return { dims, hf, structs, reg, kind: (id) => reg.index.get(id)! };
}
