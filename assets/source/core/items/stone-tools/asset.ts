// The stone tools: the pick, the hatchet and the spear, built by model.py. Each replaces the box tools/pack/weapons.ts
// draws for the same id (withArt in tools/pack/build.ts). They are modelled as held: the grip at the origin, the
// length along +Z, the side that strikes along +Y (PieceSpec.hold), and laid on their broadest side when dropped.
//
// Four tiling materials, three on a tool: wood, lashing, and stone (the pick) or flint (the hatchet and spear), each a
// layer set the image model made under tex/<name>/ from the brief beside it. Stone and flint share one relief: a trim
// sheet with a pale fresh edge, a band of cortex and the face of a flake scar (tex/stone/brief.md). Nothing on them is
// dyed: none has a colour region.

import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";

/**
 * A layer set under tex/<folder>/. Every material is held at one density, about 5,100 pixels a metre: a held tool 0.25
 * to 0.5 m from the eye with the 70 degree field is 1,500 to 3,100 pixels a metre on a 1,080-row screen and about 5,000
 * on a 4K one. So the wood's 0.4 m tile is used at 2,048 pixels, with its 1,024 set for the check, and the 0.2 m tiles
 * of the binding and the stone at their 1,024 sets; their 2,048 sets are rebuilt by their scripts and not kept.
 */
function material(folder: string, name: string, relief: string, tiles: number, size: "2048" | "1024"): MaterialSpec {
  const at = (layer: string, of = name): string => `tex/${folder}/${of}_${layer}${size === "1024" ? "_1024" : ""}.png`;
  const small = (layer: string, of = name): string => `tex/${folder}/${of}_${layer}_1024.png`;
  return {
    base: at("base"),
    normal: at("normal", relief),
    packed: at("orm"),
    height: at("height", relief),
    ...(size === "2048" ? { small: { base: small("base"), normal: small("normal", relief) } } : {}),
    tiles,
  };
}

/**
 * Radians round from the lying piece's front and above it. A picture is drawn from the lying piece, its broad side up, so
 * from high above the pick's point, the hatchet's blade and the spear's leaf show their faces and not their edges.
 */
const ICON = { around: 0.5, above: 1.25 };

export default {
  kind: "pieces",
  source: { scripts: ["model.py"] },
  pieces: [
    { id: "core:pick", object: "pick", hold: "prop_r", dropped: "auto", icon: ICON },
    { id: "core:hatchet", object: "hatchet", hold: "prop_r", dropped: "auto", icon: ICON },
    // Whole, the spear's leaf is a few pixels at the end of a long diagonal: the picture is its head and lashing, the
    // shaft running off at the bottom left.
    { id: "core:spear", object: "spear", hold: "prop_r", dropped: "auto", icon: { ...ICON, zoom: 3, shift: [0.62, 0.62] } },
  ],
  // Metres a picture spans, as model.py's TILE lays them.
  materials: {
    wood: material("wood", "wood", "wood", 0.4, "2048"),
    lashing: material("lashing", "lashing", "lashing", 0.2, "1024"),
    // The stone sheet's pale edge and cortex bands lift its mean, so stone and flint say the colour of a face to be drawn
    // flat in: the flint stays dark from afar, as the hatchet and spear read in the hand.
    stone: { ...material("stone", "stone", "stone", 0.2, "1024"), flat: [128, 126, 120] },
    flint: { ...material("stone", "flint", "stone", 0.2, "1024"), flat: [78, 76, 80] },
  },
  // Levels 0 and 1 keep their materials; 2 and on are flat. A held tool is drawn at level 0 in first person, and in
  // third person within about 8 m on medium. Proposed as the budget of any one held item, the first entry of the open
  // contract "asset budgets per device": triangles 1,200, 480, 160, 48, level 2 the first flat; at most three materials,
  // near 5,000 pixels a metre; 32 MB of textures alone in the RGBA variant (18 MB block-compressed). This asset's 42 MB
  // is the three tools' four materials, each counted once.
  flat: 2,
  budgets: { triangles: [1200, 480, 160, 48], texture: { top: 2048, megabytes: 42 } },
} satisfies PiecesAsset;
