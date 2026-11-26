import type { Def } from "../../shared/content/defs.ts";
import {
  SKIN_ABDOMEN, SKIN_CHEST, SKIN_PELVIS, SKIN_SHIN_L, SKIN_SHIN_R, SKIN_THIGH_LOW_L, SKIN_THIGH_LOW_R, SKIN_THIGH_TOP_L, SKIN_THIGH_TOP_R, SKIN_UPPER_ARM_TOP_L,
  SKIN_UPPER_ARM_TOP_R,
} from "../../shared/anim/skin-zones.ts";

// Clothing worn in the wardrobe slots, giving no armor. These two stand in until the cuts are made: they have no mesh yet,
// and every number is chosen.

export const GARMENTS: readonly Def[] = [
  { type: "item", class: "garment", id: "core:plain_tee", stack: 1, weight: 0.2, label: "plain tee", color: 15,
    garment: { slot: "top", covers: [SKIN_CHEST, SKIN_ABDOMEN, SKIN_UPPER_ARM_TOP_L, SKIN_UPPER_ARM_TOP_R], dyes: true } },
  { type: "item", class: "garment", id: "core:plain_trousers", stack: 1, weight: 0.5, label: "plain trousers", color: 15,
    garment: { slot: "bottom", covers: [SKIN_PELVIS, SKIN_THIGH_TOP_L, SKIN_THIGH_LOW_L, SKIN_SHIN_L, SKIN_THIGH_TOP_R, SKIN_THIGH_LOW_R, SKIN_SHIN_R], dyes: true } },
];
