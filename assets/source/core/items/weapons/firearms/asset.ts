// The early firearms: the revolver, the long rifle, the shotgun and the flare gun, built by model.py. Each replaces the
// box tools/pack/weapons.ts draws for the same id (withArt in tools/pack/build.ts): core:pistol and core:rifle now;
// core:shotgun (the weapons program's W3) and core:flare_gun (W6) have no item yet, and are drawn once their items
// name them. Each is held on the right prop bone, lies on its side, and is pictured from above (ref/TRAITS.md).
//
// Materials (../materials.ts): the stone tools' wood, lashing and flint, and the new steel and hide, three on a gun.

import type { PiecesAsset } from "../../../../../../tools/art/spec.ts";
import { FLINT, HELD_TRIANGLES, HIDE, LASHING, STEEL, WOOD } from "../materials.ts";

/** Radians round from the lying gun's front and above it: from high above, so its side shows and not its back. */
const ICON = { around: 0.5, above: 1.25 };

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    { id: "core:pistol", object: "pistol", hold: "prop_r", dropped: "auto", icon: ICON },
    { id: "core:rifle", object: "rifle", hold: "prop_r", dropped: "auto", icon: ICON },
    { id: "core:shotgun", object: "shotgun", hold: "prop_r", dropped: "auto", icon: ICON },
    { id: "core:flare_gun", object: "flare_gun", hold: "prop_r", dropped: "auto", icon: ICON },
  ],
  materials: { wood: WOOD, steel: STEEL, hide: HIDE, lashing: LASHING, flint: FLINT },
  // The held item's budget (D416). This asset's 50.7 MB in the RGBA variant is its five materials, each counted once;
  // any one gun's three come to about 32 MB (wood about 13, each of the others about 9.4).
  flat: 2,
  budgets: { triangles: [...HELD_TRIANGLES], texture: { top: 2048, megabytes: 51 } },
} satisfies PiecesAsset;
