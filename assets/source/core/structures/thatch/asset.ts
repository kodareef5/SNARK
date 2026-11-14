// The thatch tier's building pieces, built by model.py. Each takes the place of the grey box of the same id.

import type { PiecesAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    { id: "core:foundation_thatch", object: "foundation" },
    { id: "core:wall_thatch", object: "wall" },
    { id: "core:doorframe_thatch", object: "doorframe" },
    { id: "core:ceiling_thatch", object: "ceiling" },
    { id: "core:door_thatch", object: "door" },
    { id: "core:door_open_thatch", object: "door_open" },
  ],
  budgets: { triangles: [800, 400, 160, 36], texture: { top: 2048, megabytes: 64 } },
} satisfies PiecesAsset;
