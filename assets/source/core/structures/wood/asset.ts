// The wood tier's building pieces, built by model.py. Each replaces the grey box of the structure with its id.

import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

const PIECES = ["foundation", "wall", "doorframe", "windowframe", "ceiling", "pillar", "door", "door_open", "stairs"];

/** A whole layer set under tex/<name>/, made by the image model from the briefs beside it. */
const material = (name: string, tiles?: number): MaterialSpec => ({
  base: `tex/${name}/${name}_base.png`,
  normal: `tex/${name}/${name}_normal.png`,
  packed: `tex/${name}/${name}_orm.png`,
  height: `tex/${name}/${name}_height.png`,
  ...(tiles ? { tiles } : {}),
});

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  // The foundation's crib is hollow under its deck and stands on the ground, so the faces a measure of points finds
  // furthest from its coarser levels are ones nobody sees: its levels state what shows from outside instead.
  pieces: PIECES.map((name) => ({ id: `core:${name}_wood`, object: name, ...(name === "foundation" ? { errors: [0.012, 0.025, 0.05] } : {}) })),
  // By the names model.py gives them. Boards, deck and timber tile every 3 m; fittings is a sheet of parts laid one by
  // one, 1 m across, so its span is measured on the meshes. The first two levels are drawn with them, the rest flat,
  // and the materials model.py gives only those (boards_b, deck_b, timber_b) take the palette colour nearest their own.
  materials: { boards: material("boards", 3), deck: material("deck", 3), timber: material("timber", 3), fittings: material("fittings") },
  budgets: { triangles: [2400, 900, 260, 36], texture: { top: 2048, megabytes: 64 } },
} satisfies PiecesAsset;
