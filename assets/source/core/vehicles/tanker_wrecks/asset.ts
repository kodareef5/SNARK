import bounds from "../../../../../content/vehicles/tanker-wreck-bounds.json" with { type: "json" };
import type { PiecesAsset } from "../../../../../tools/art/spec.ts";
export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: Object.keys(bounds).map((state) => ({ id: `core:tanker_${state}`, object: `tanker_${state}` })),
  materials: { livery: { base: "../tanker/tex/salvage.png", packed: "../tanker/tex/orm.png" } },
  flat: 1,
  budgets: { triangles: [14600, 9800, 3750, 880], texture: { top: 1024, megabytes: 12 } },
} satisfies PiecesAsset;
