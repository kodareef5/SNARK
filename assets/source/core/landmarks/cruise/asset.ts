import layout from "../../../../../content/landmarks/cruise-layout.json" with { type: "json" };
import statedErrors from "./lod-errors.json" with { type: "json" };
import type { PiecesAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: layout.prototypes.map(p => ({ id: p.mesh, object: p.mesh.slice(5), errors: (statedErrors as Record<string, number[]>)[p.mesh] })),
  materials: { surfaces: { base: "tex/surfaces_base.png", normal: "tex/surfaces_normal.png", packed: "tex/surfaces_packed.png", height: "tex/surfaces_height.png" },
    signs: { base: "tex/signs_base.png", packed: "tex/signs_packed.png" } },
  budgets: { triangles: [15000, 10000, 7000, 4000, 2000, 1000], texture: { top: 2048, megabytes: 64 } },
} satisfies PiecesAsset;
