// The bow and the crossbow, built by model.py. core:crossbow replaces the box tools/pack/weapons.ts draws for it
// (withArt in tools/pack/build.ts), held on the right prop bone, lying on its side. The bow's held piece is modelled
// ("bow") but not named here: the check holds a left-hand piece to the right hand's axes, which a bow in the left hand's
// cannot meet (ref/TRAITS.md, "The bow in the left hand"). Until the left hand's axes are stated the box stays in the
// hand, and only the bow's lying piece is named, core:bow/dropped, as a bag of one bow shows it and its inventory
// picture is drawn from (D403, D409).
//
// Materials (../materials.ts): the stone tools' wood and lashing, and the new hide and steel, three on each.

import type { PiecesAsset } from "../../../../../../tools/art/spec.ts";
import { HELD_TRIANGLES, HIDE, LASHING, STEEL, WOOD } from "../materials.ts";

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    { id: "core:bow/dropped", object: "bow_lying", icon: { around: 0.5, above: 1.3 } },
    { id: "core:crossbow", object: "crossbow", hold: "prop_r", dropped: "auto", icon: { around: 0.5, above: 1.25 } },
  ],
  materials: { wood: WOOD, lashing: LASHING, hide: HIDE, steel: STEEL },
  // The held item's budget (D416). This asset's 41.3 MB in the RGBA variant is its four materials, each counted once;
  // the crossbow's three, or the bow's, come to about 32 MB.
  flat: 2,
  budgets: { triangles: [...HELD_TRIANGLES], texture: { top: 2048, megabytes: 42 } },
} satisfies PiecesAsset;
