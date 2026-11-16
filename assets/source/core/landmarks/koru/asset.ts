import layout from "../../../../../content/landmarks/koru-layout.json" with { type: "json" };
import type { PiecesAsset } from "../../../../../tools/art/spec.ts";

/** One shared native pack, independently bounded pieces and six authored levels preserving near-flat openings. */
export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: layout.modules.map((m) => ({ id: m.mesh, object: m.mesh.slice(5) })),
  materials: {
    signs: { base: "tex/signs_base.png", packed: "tex/signs_packed.png" },
    surfaces: {
      base: "tex/surfaces_base.png", normal: "tex/surfaces_normal.png", packed: "tex/surfaces_packed.png",
      height: "tex/surfaces_height.png",
    },
  },
  budgets: { triangles: [15000, 10000, 7000, 4000, 2000, 1000], texture: { top: 2048, megabytes: 64 } },
} satisfies PiecesAsset;
