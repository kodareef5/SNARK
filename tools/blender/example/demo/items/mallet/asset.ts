// An example of a held item built by a script. It is not in the game: `bun run art -- --source tools/blender/example demo:mallet`.

import type { PiecesAsset } from "../../../../../art/spec.ts";

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  // An item's piece has the id its class's slots name: the held mesh is the item's weapon mesh for a weapon, and
  // "<id>/dropped" is made beside it. It is held in the right hand, and lies as the build lays it.
  pieces: [{ id: "demo:mallet", object: "mallet", hold: "prop_r", dropped: "auto" }],
  budgets: { triangles: [64] },
} satisfies PiecesAsset;
