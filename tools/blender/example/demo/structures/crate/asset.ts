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
  budgets: { triangles: [64] },
} satisfies PiecesAsset;
