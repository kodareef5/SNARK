// Sloped and three-sided pieces made of convex parts, defined for tests only: a ramp wedge, a triangle on 60 degree axes and a
// sloped roof slab. The game's content has none yet.

import { CORE_CONTENT } from "../../content/core.ts";
import { shapeHalf, type Def, type ShapeDef } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import type { TestWorld } from "./world.ts";

const H = 1.5;
/** A foundation's half thickness. */
export const TRIANGLE_HALF = 0.1875;
/** The roof slab rises this much over its run of 3 m, and is this thick, upright. */
export const ROOF_RISE = 1.5;
export const ROOF_THICK = 0.2;

const shapes: readonly ShapeDef[] = [
  // Rises a storey over a side, toward +Z: 45 degrees.
  { type: "shape", id: "test:shape_ramp", role: "stairs", boxes: [], hulls: [{ corners: [[-H, -H, -H], [H, -H, -H], [-H, -H, H], [H, -H, H], [-H, H, H], [H, H, H]] }] },
  // Its origin is a corner, and its sides run 3 m along the first axis and 3 m along the second, 60 degrees on.
  {
    type: "shape",
    id: "test:shape_triangle",
    role: "foundation",
    boxes: [],
    hulls: [{ sixty: true, corners: [0, 3].flatMap((a) => [-TRIANGLE_HALF, TRIANGLE_HALF].map((y) => [a, y, 0] as [number, number, number])).concat([-TRIANGLE_HALF, TRIANGLE_HALF].map((y) => [0, y, 3] as [number, number, number])) }],
  },
  {
    type: "shape",
    id: "test:shape_roof",
    role: "ceiling",
    boxes: [],
    hulls: [{ corners: [-H, H].flatMap((x) => [[x, -ROOF_RISE / 2 - ROOF_THICK / 2, -H], [x, -ROOF_RISE / 2 + ROOF_THICK / 2, -H], [x, ROOF_RISE / 2 - ROOF_THICK / 2, H], [x, ROOF_RISE / 2 + ROOF_THICK / 2, H]] as [number, number, number][]) }],
  },
];

export const HULL_DEFS: readonly Def[] = [
  ...shapes,
  ...shapes.map((s): Def => ({ type: "structure", class: "piece", id: s.id.replace("shape_", ""), mesh: "shape", shape: s.id, half: shapeHalf(s.boxes, s.hulls), color: 5, hp: 10000, material: "core:mat_stone" })),
];

export function hullRegistry(): Registry {
  const { registry, errors } = compileContent([...CORE_CONTENT, ...HULL_DEFS]);
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
