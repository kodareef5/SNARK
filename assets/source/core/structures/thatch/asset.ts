// The thatch tier's building pieces, built by model.py from the geometry in pieces.py. Each takes the place of the grey box of the same id.

import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

/** A whole layer set under tex/<name>/. */
const picture = (name: string, more: Partial<MaterialSpec> = {}): MaterialSpec => ({
  base: `tex/${name}/${name}_base.png`,
  normal: `tex/${name}/${name}_normal.png`,
  packed: `tex/${name}/${name}_orm.png`,
  height: `tex/${name}/${name}_height.png`,
  ...more,
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
  // By the names model.py gives them. The wall and door pictures are painted to their pieces and wrap only across, and
  // the wood is a sheet of bands, each wrapping on itself, so those three say nothing of tiling. The eaves wear the
  // wall's skirts.
  materials: {
    thatch: picture("thatch", { cutout: true, twoSided: true }),
    door: picture("door", { cutout: true, twoSided: true }),
    // Drawn flat in bark, which most poles wear: the sheet's mean takes in its pale cord and peeled bands.
    wood: picture("wood", { flat: [116, 72, 42] }),
    roof: picture("roof", { tiles: 3 }),
    // The mats' mean lands on an olive tone; this is the tan straw nearest it.
    floor: picture("floor", { tiles: 3, flat: [176, 130, 81] }),
    earth: picture("earth", { tiles: 1.5 }),
  },
  // Six materials, since each piece is made of its own thing: 13.3 MB each at the top size, a quarter of that on medium.
  budgets: { triangles: [4500, 2000, 700, 60], texture: { top: 2048, megabytes: 80 } },
} satisfies PiecesAsset;
