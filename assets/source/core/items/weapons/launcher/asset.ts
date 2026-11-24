// The rocket launcher and its round, built by model.py: the launcher held on the right prop bone, lying on its side and
// pictured from above as the firearms are, and the round the client draws in flight, in the loaded tube and in the off
// hand while reloading. Each replaces the box tools/pack/weapons.ts draws for the same id (withArt in tools/pack/build.ts).
//
// Materials: "metal" and "furniture", two small trim sheets (tex.py, bands.py): two draws for the launcher and one for
// the round. Every level is made by hand in model.py, so the asset names no `flat`: the first two of each piece are
// drawn with materials, and the rest in the palette colours of their own faces.

import type { PiecesAsset } from "../../../../../../tools/art/spec.ts";
import { HELD_TRIANGLES } from "../materials.ts";

/** Radians round from the lying launcher's front and above it, as the firearms' pictures: its side shows. */
const ICON = { around: 0.5, above: 1.25 };

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    { id: "core:rocket_launcher", object: "launcher", hold: "prop_r", dropped: "auto", icon: ICON },
    { id: "core:rocket_round", object: "round", triangles: [160, 64, 24] },
  ],
  materials: {
    metal: { base: "tex/metal_base.png", normal: "tex/metal_normal.png", packed: "tex/metal_orm.png" },
    furniture: { base: "tex/furniture_base.png", normal: "tex/furniture_normal.png", packed: "tex/furniture_orm.png" },
  },
  budgets: { triangles: [...HELD_TRIANGLES], texture: { top: 512, megabytes: 5 } },
} satisfies PiecesAsset;
