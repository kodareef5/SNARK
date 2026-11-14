// An example of rigid pieces built by a script. It is not in the game: `bun run art -- --source tools/blender/example demo:crate`.

import type { PiecesAsset } from "../../../../../art/spec.ts";

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  // A piece whose id is a structure's would take the place of that structure's grey box.
  pieces: [
    { id: "demo:crate", object: "crate" },
    { id: "demo:crate_lid", object: "lid" },
  ],
  // By the name model.py gives the material. The paths are within this folder, and ../../pictures.ts drew them.
  materials: {
    Planks: { base: "tex/planks_base.png", normal: "tex/planks_normal.png", packed: "tex/planks_packed.png", height: "tex/planks_height.png", tiles: 1 },
  },
  budgets: { triangles: [64], texture: { top: 64, megabytes: 1 } },
} satisfies PiecesAsset;
