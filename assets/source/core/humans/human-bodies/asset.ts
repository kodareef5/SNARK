// The two modelled bodies, with hair, beards and armor sets fitted to each. The hair and beard styles are in
// shared/anim/look.ts, since the character creator offers them.

import { meridian } from "./meridian/model.ts";
import type { HumanBodiesAsset } from "../../../../../tools/art/spec.ts";

export default {
  kind: "human-bodies",
  raw: "quaternius",
  tailored: { material: "meridian", indicatorEmission: 0.72, make: meridian },
  materials: { meridian: {
    base: "meridian/finish.png", normal: "meridian/normal.png", packed: "meridian/orm.png",
    regions: "meridian/dye.png", tiles: 0.65,
  } },
  triangles: { body: [4400, 1500, 420], hair: [420, 150, 48], armor: [900, 320, 100] },
  bodies: [
    { file: "base-characters/Superhero_Male_FullBody.gltf", material: "MI_Superhero_Male", texture: "base-characters/T_Superhero_Male_Ligh.png", outfits: "Male" },
    { file: "base-characters/Superhero_Female_FullBody.gltf", material: "MI_Superhero_Female", texture: "base-characters/T_Superhero_Female_Light_BaseColor.png", outfits: "Female" },
  ],
  eyes: "base-characters/T_Eye_Brown.png",
  hair: "base-characters/hair",
  outfits: {
    folder: "outfits-fantasy",
    files: [
      "Male_Peasant_Arms", "Male_Peasant_Body", "Male_Peasant_Feet", "Male_Peasant_Legs", "Male_Ranger_Arms", "Male_Ranger_Body", "Male_Ranger_Feet_Boots", "Male_Ranger_Head_Hood", "Male_Ranger_Legs",
      "Female_Peasant_Arms", "Female_Peasant_Body", "Female_Peasant_Feet", "Female_Peasant_Legs", "Female_Ranger_Arms", "Female_Ranger_Body", "Female_Ranger_Feet", "Female_Ranger_Head_Hood", "Female_Ranger_Legs",
    ],
    // The peasant outfit has no head part, so the cloth set borrows the ranger's hood.
    sets: [
      { id: "cloth", parts: ["Peasant_Arms", "Peasant_Body", "Peasant_Feet", "Peasant_Legs", "Ranger_Head_Hood"], texture: "T_Peasant_BaseColor.png" },
      { id: "hide", parts: ["Ranger_Arms", "Ranger_Body", "Ranger_Feet", "Ranger_Legs", "Ranger_Head_Hood"], texture: "T_Ranger_BaseColor.png" },
    ],
  },
} satisfies HumanBodiesAsset;
