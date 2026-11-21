// The frond glider (planning/workstreams/glider.md), built by model.py: its two wings, each on the prop bone of its
// hand while the glider is open, and the glider folded and tied, which is the item in the hand, on the ground and in its
// picture. The wings replace the boxes tools/pack/glider.ts draws under the same ids (withArt in tools/pack/build.ts).
//
// Nothing here is painted anew. The fronds wear the coconut palm's frond picture, cut out by its alpha, and the sticks
// and bindings the stone tools' wood and lashing: each is said here by the folder its pictures are in, so the game
// stores them once (assets/source/README.md, "Materials"). Nothing is dyed: none has a colour region.

import { resolve } from "node:path";
import { shared, type PiecesAsset } from "../../../../../tools/art/spec.ts";

const TOOLS = resolve(import.meta.dir, "../stone-tools");
const TREES = resolve(import.meta.dir, "../../nodes/trees");

/** From above and a little to one side: the wing's whole plan, which is what says what it is. */
const BUNDLE_ICON = { around: 0.5, above: 1.25 };

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    { id: "core:frond_glider/wing_l", object: "wing_l", hold: "prop_l", wing: true },
    { id: "core:frond_glider/wing_r", object: "wing_r", hold: "prop_r", wing: true },
    // Folded, it is held as a spear is, and lies on its side.
    { id: "core:frond_glider", object: "bundle", hold: "prop_r", dropped: "auto", icon: BUNDLE_ICON, triangles: [900, 400, 160, 60] },
  ],
  materials: {
    // Metres a picture spans, as model.py's TILE lays them.
    wood: shared(TOOLS, "core:frond-glider/wood", { base: "tex/wood/wood_base_1024.png", normal: "tex/wood/wood_normal_1024.png", packed: "tex/wood/wood_orm_1024.png", height: "tex/wood/wood_height_1024.png", tiles: 0.4 }),
    lashing: shared(TOOLS, "core:frond-glider/lashing", { base: "tex/lashing/lashing_base_1024.png", normal: "tex/lashing/lashing_normal_1024.png", packed: "tex/lashing/lashing_orm_1024.png", height: "tex/lashing/lashing_height_1024.png", tiles: 0.2 }),
    // One picture of three whole fronds, which does not tile: this asset's own material, of the palms' pictures.
    frond: { base: "tex/coconut_frond/coconut_frond_base.png", normal: "tex/coconut_frond/coconut_frond_normal.png", packed: "tex/coconut_frond/coconut_frond_orm.png", height: "tex/coconut_frond/coconut_frond_height.png", cutout: true, dir: TREES },
  },
  // Levels 0 and 1 keep their materials; 2 and on are flat. A wing is seen from 3 to 6 m in third person and overhead in
  // first, and at 4 m span holds its shape from far: its levels carry more than a held tool's.
  flat: 2,
  budgets: { triangles: [1800, 760, 260, 90], texture: { top: 2048, megabytes: 60 } },
} satisfies PiecesAsset;
