// The stone tier's building pieces: mortared rough-cut limestone, dressed jamb stones, oak lintels, sills and beams,
// flagstone floors and an iron-bound oak door. Every piece is built by model.py from the patterns in layout.py, which
// the textures in tex/ are painted to.

import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

/** Each of the tier's materials is a whole layer set under tex/, and spans one building span, 3 m, on the grid. */
const material = (name: string): MaterialSpec => ({
  base: `tex/${name}/${name}_base.png`,
  normal: `tex/${name}/${name}_normal.png`,
  packed: `tex/${name}/${name}_orm.png`,
  height: `tex/${name}/${name}_height.png`,
  tiles: 3,
});

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    { id: "core:foundation_stone", object: "foundation" },
    { id: "core:wall_stone", object: "wall" },
    { id: "core:doorframe_stone", object: "doorframe" },
    { id: "core:windowframe_stone", object: "windowframe" },
    { id: "core:ceiling_stone", object: "ceiling" },
    { id: "core:pillar_stone", object: "pillar" },
    { id: "core:stairs_stone", object: "stairs" },
    { id: "core:door_stone", object: "door" },
    { id: "core:door_open_stone", object: "door_open" },
  ],
  // By the names model.py gives them.
  materials: { masonry: material("masonry"), flags: material("flags"), dressed: material("dressed"), timber: material("timber"), iron: material("iron") },
  // Every walling stone is a solid of its own, 30 triangles at the finest and 14 at the next, so a wall is about
  // 3,000 at its finest, 1,500 within about 50 m, 200 to 140 m and a box beyond.
  budgets: { triangles: [3200, 1600, 260, 16], texture: { top: 2048, megabytes: 80 } },
} satisfies PiecesAsset;
