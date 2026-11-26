// The two modelled bodies, with hair, beards and armor sets fitted to each. The hair and beard styles are in
// shared/anim/look.ts, since the character creator offers them.

import { meridian } from "./meridian/model.ts";
import { RIGS } from "./rigs.ts";
import type { HumanBodiesAsset, MaterialSpec } from "../../../../../tools/art/spec.ts";

/** A material skin/paint.ts painted, by its name there: base colour and normal at 2,048, the packed map at 1,024, masks at 512. */
const painted = (name: string, file: string, mask = 512): Record<string, MaterialSpec> => ({
  [name]: { base: `skin/${file}-base.png`, normal: `skin/${file}-normal.png`, packed: `skin/${file}-orm.png`, regions: { mask: `skin/${file}-mask.png`, mask2: `skin/${file}-mask2.png` }, tops: { mask } },
});

export default {
  kind: "human-bodies",
  raw: "quaternius",
  tailored: { material: "meridian", indicatorEmission: 1.05, visor: true, exhaust: true, make: meridian },
  materials: {
    meridian: {
      base: "meridian/finish.png", normal: "meridian/normal.png", packed: "meridian/orm.png",
      regions: "meridian/dye.png", tiles: 0.65, tops: { mask: 512 },
    },
    // Painted by skin/paint.ts from the base colours the packs came with.
    ...painted("skin_m", "skin-m"), ...painted("skin_f", "skin-f"), ...painted("eyes", "eyes", 128), ...painted("hair_1", "hair-1"), ...painted("hair_2", "hair-2"),
    ...painted("cloth", "cloth"), ...painted("hide", "hide"), ...painted("regular_m", "regular-m"), ...painted("regular_f", "regular-f"),
    // Painted by skin/makehuman.ts from MakeHuman's CC0 pictures: one skin for both sexes, each with its own underwear masks.
    skin_mh_m: { base: "skin/mh-skin-base.png", normal: "skin/mh-skin-normal.png", packed: "skin/mh-skin-orm.png", regions: { mask: "skin/mh-skin-m-mask.png", mask2: "skin/mh-skin-m-mask2.png" }, tops: { mask: 512 } },
    skin_mh_f: {
      base: "skin/mh-skin-base.png", normal: "skin/mh-skin-normal.png", packed: "skin/mh-skin-orm.png", regions: { mask: "skin/mh-skin-f-mask.png", mask2: "skin/mh-skin-f-mask2.png" }, tops: { mask: 512 },
      borrows: { from: "skin_mh_m", roles: ["base", "normal", "mro"] },
    },
    eyes_mh: { base: "skin/mh-eyes-base.png", normal: "skin/mh-eyes-normal.png", packed: "skin/mh-eyes-orm.png", regions: { mask: "skin/mh-eyes-mask.png", mask2: "skin/mh-eyes-mask2.png" } },
    brows_mh: { base: "skin/mh-brows-base.png", normal: "skin/mh-brows-normal.png", packed: "skin/mh-brows-orm.png", regions: { mask: "skin/mh-brows-mask.png", mask2: "skin/mh-brows-mask2.png" }, cutout: true, twoSided: true },
  },
  dressed: {
    MI_Superhero_Male: "skin_m", MI_Superhero_Female: "skin_f", MI_Eyes: "eyes", MI_Hair_1: "hair_1", MI_Hair_2: "hair_2",
    MI_Peasant: "cloth", MI_Ranger: "hide", MI_Regular_Male: "regular_m", MI_Regular_Female: "regular_f",
  },
  triangles: { body: [16000, 4000, 1480, 420], hair: [1400, 420, 136, 44], armor: [9000, 2400, 1500, 480], tailored: [4400, 1500, 420] },
  flat: 2,
  body: "makehuman",
  makehuman: { triangles: [26000, 3400, 1480, 420], skin: ["skin_mh_m", "skin_mh_f"], eyes: "eyes_mh", brows: "brows_mh" },
  bodies: [
    { file: "base-characters/Superhero_Male_FullBody.gltf", material: "MI_Superhero_Male", texture: "base-characters/T_Superhero_Male_Ligh.png", outfits: "Male" },
    { file: "base-characters/Superhero_Female_FullBody.gltf", material: "MI_Superhero_Female", texture: "base-characters/T_Superhero_Female_Light_BaseColor.png", outfits: "Female" },
  ],
  rigs: RIGS,
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
