// The thrown weapons and the projectiles, built by model.py: the grenade held and live, the bola held and lying, the
// arrow and the dart. Each replaces the box tools/pack/weapons.ts draws for the same id (withArt in
// tools/pack/build.ts): core:grenade, core:grenade_thrown, core:arrow and core:dart now; core:bola (the weapons
// program's W4) has no item yet, and is drawn once its item names it. The held ones are on the right prop bone; the
// projectiles keep their boxes' axes (ref/TRAITS.md, "Held and flown").
//
// Materials (../materials.ts): the stone tools' wood, lashing and flint, and the new steel and hide, three at most on
// a piece.

import type { PiecesAsset } from "../../../../../../tools/art/spec.ts";
import { FLINT, HELD_TRIANGLES, HIDE, LASHING, STEEL, WOOD } from "../materials.ts";

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    // From a little above its side, so the lever, the ring and the band all show.
    { id: "core:grenade", object: "grenade", hold: "prop_r", dropped: "auto", icon: { around: 0.6, above: 0.5 } },
    { id: "core:grenade_thrown", object: "grenade_thrown" },
    // Lying in its Y, a piece of its own; its far level is made by hand (model.py, bola_far).
    { id: "core:bola", object: "bola", hold: "prop_r", dropped: "bola_lying", icon: { around: 0.5, above: 1.3 } },
    { id: "core:arrow", object: "arrow" },
    { id: "core:dart", object: "dart" },
  ],
  materials: { wood: WOOD, flint: FLINT, lashing: LASHING, hide: HIDE, steel: STEEL },
  // The held item's budget (D416). This asset's 50.7 MB in the RGBA variant is its five materials, each counted once;
  // the grenade's three come to about 28 MB, the arrow's about 32.
  flat: 2,
  budgets: { triangles: [...HELD_TRIANGLES], texture: { top: 2048, megabytes: 51 } },
} satisfies PiecesAsset;
