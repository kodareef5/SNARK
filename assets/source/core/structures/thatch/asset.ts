// The thatch tier's building pieces, built by model.py. Each takes the place of the grey box of the same id.

import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

/** Each of the tier's materials is a whole layer set under tex/, and tiles every 1.5 m on the building grid. */
const material = (name: string): MaterialSpec => ({
  base: `tex/${name}/${name}_base.png`,
  normal: `tex/${name}/${name}_normal.png`,
  packed: `tex/${name}/${name}_orm.png`,
  height: `tex/${name}/${name}_height.png`,
  tiles: 1.5,
});

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
  // By the names model.py gives them.
  materials: { Thatch: material("thatch"), Mat: material("mat"), Pole: material("pole"), Cord: material("cord") },
  budgets: { triangles: [800, 400, 160, 36], texture: { top: 2048, megabytes: 64 } },
} satisfies PiecesAsset;
