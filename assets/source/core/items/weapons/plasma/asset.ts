// The plasma guns and their bolt, built by model.py: the rifle and the pistol, each held on the right prop bone, lying
// on its side and pictured from above as the firearms are, and the bolt, the muzzle flash and the impact burst the
// client draws for a shot. The guns are cut from two models by Jerd (ATTRIBUTION.md) to the held item's budget.
//
// Materials: "tek", one small picture of three bands (tex.py: gunmetal alloy, dark alloy, ceramic plate) that both guns
// lie in, and "glow", their lenses: two draws a gun. "plasma" is the bolt's, flash's and burst's. The two that glow
// have no pictures, only a colour.

import type { PiecesAsset } from "../../../../../../tools/art/spec.ts";
import { HELD_TRIANGLES } from "../materials.ts";

/** Radians round from the lying gun's front and above it, as the firearms' pictures: its side shows. */
const ICON = { around: 0.5, above: 1.25 };
const LICENSE = "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)";

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    {
      id: "core:rifle_plasma", object: "rifle", hold: "prop_r", dropped: "auto", icon: ICON,
      modelCredit: `Electric Rifle by Jerd (https://sketchfab.com/3d-models/electric-rifle-1a940582312e41cdadca0fbe948da754). ${LICENSE}. SNARK simplified and retextured the model`,
    },
    {
      id: "core:pistol_plasma", object: "pistol", hold: "prop_r", dropped: "auto", icon: ICON,
      modelCredit: `Low Poly Pistol by Jerd (https://sketchfab.com/3d-models/low-poly-pistol-77d5a6313555495ca2810b6a1fe707a9). Mesh by Quaternius. ${LICENSE}. SNARK simplified and retextured the model`,
    },
    // One level each, so a bolt glows at any distance: a flat level has no glow.
    { id: "core:plasma_bolt", object: "bolt", triangles: [100] },
    { id: "core:plasma_flash", object: "flash", triangles: [100] },
    { id: "core:plasma_burst", object: "burst", triangles: [100] },
  ],
  materials: {
    tek: { base: "tex/tek_base.png", normal: "tex/tek_normal.png", packed: "tex/tek_orm.png" },
    // Cyan, sRGB 80, 220, 255, as light: a lens just past where bloom starts (client/core/render/post.ts, BLOOM_FROM).
    glow: { tint: [0.08, 0.72, 1], emissive: 2.4, flat: [80, 220, 255] },
    // Cyan-white and four times a sunlit white wall, so a bolt blooms by day.
    plasma: { tint: [0.3, 0.85, 1], emissive: 6, flat: [150, 235, 255] },
  },
  // The held item's budget, as the firearms'. The 480 level is made only if the simplifier gets a fifth off the finest.
  flat: 2,
  budgets: { triangles: [...HELD_TRIANGLES], texture: { top: 512, megabytes: 3 } },
} satisfies PiecesAsset;
