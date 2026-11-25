// The UFO of the map events (planning/workstreams/map-events.md), from FlexUnit's CC0 disc (ref/SOURCES.md): the craft
// in three parts the client turns apart (client/core/mapevent/craft.ts), its wreck, and the core thrown clear of it.
//
// convert.py reads the raw file once into ref/flexunit.json; shape.py sizes and smooths that profile to the sky's hull
// (22 m across, 6.4 m through), craft.py builds the parts on it, paint.py paints the tiling pictures. Every glowing
// face is the `glow` material, colour region 0, which the client sets to the craft's colour: cold cyan, the shield's
// white flicker when it breaks, a dying ember on the wreck. The core prop's region 0 is its content colour.
//
//   python3 assets/source/core/events/ufo/paint.py
//   bun run art -- core:ufo
//   bun assets/source/core/events/ufo/review.ts
import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";
import { HULL_TILE, TRIM_TILE } from "./tiles.ts";

const maps = (name: string, tiles: number, extra: Partial<MaterialSpec> = {}): MaterialSpec => ({
  base: `tex/${name}_base.png`, normal: `tex/${name}_normal.png`, packed: `tex/${name}_packed.png`, height: `tex/${name}_height.png`, tiles, ...extra,
});

export default {
  kind: "pieces",
  modelCredit: "FlexUnit · CC0",
  source: { scripts: ["model.py"] },
  pieces: [
    // What stands still: the hull, the mast and the lenses under it.
    { id: "core:ufo_craft", object: "craft", triangles: [17000, 6400, 2400, 820, 330] },
    // The knife-edged rim, which turns slowly, and the ring under the belly, which turns fast.
    { id: "core:ufo_rim", object: "rim", triangles: [4400, 1500, 420, 120, 48] },
    { id: "core:ufo_ring", object: "ring", triangles: [2900, 900, 200, 64, 24] },
    // Its wreck at rest, debris and all (wreck.py), drawn where it came to rest; its plating burnt, its light the
    // client's ember. A player walks up to it, so its finest level keeps 12,000 triangles of the 22,000 made. Its two
    // coarsest levels lose the debris, a metre or two across each, which their points measure as 4.5 and 7 m out:
    // stated as the size of a piece, they are drawn from about 300 m on medium, where a piece is a pixel.
    { id: "core:ufo_wreck", object: "wreck", triangles: [12000, 4800, 1800, 640, 260], errors: [0.04, 0.11, 1.5, 2.5] },
    // The core thrown clear of it, a crate anyone may loot (content/core.ts), its light the prop's colour.
    { id: "core:ufo_core", object: "core", triangles: [1000, 420, 160, 60] },
  ],
  materials: {
    hull: maps("hull", HULL_TILE),
    trim: maps("trim", TRIM_TILE, { tops: { mro: 512 } }),
    burnt: maps("burnt", HULL_TILE),
    // As bright as a lamp by day and seen across the map by night; drawn flat in the craft's glow, region 0.
    glow: { base: "tex/glow_base.png", packed: "tex/glow_packed.png", regions: { mask: "tex/glow_mask.png" }, emissive: 2.2, indicator: true, flat: [64, 232, 255] },
  },
  // The two finest levels keep their pictures (to about 210 m on medium, 330 m on high); from the third on, flat colours,
  // the glow in region 0. A third textured level is not made: the lathe's seams of light hold the simplifier above it.
  flat: 2,
  budgets: { triangles: [17000, 6400, 2400, 820, 330], texture: { top: 1024, megabytes: 32 } },
} satisfies PiecesAsset;
