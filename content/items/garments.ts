import type { Def } from "../../shared/content/defs.ts";
import {
  SKIN_ABDOMEN, SKIN_CHEST, SKIN_COLLAR, SKIN_FOOT_L, SKIN_FOOT_R, SKIN_FOREARM_L, SKIN_FOREARM_R, SKIN_PELVIS, SKIN_SHIN_L, SKIN_SHIN_R, SKIN_THIGH_LOW_L,
  SKIN_THIGH_LOW_R, SKIN_THIGH_TOP_L, SKIN_THIGH_TOP_R, SKIN_UPPER_ARM_LOW_L, SKIN_UPPER_ARM_LOW_R, SKIN_UPPER_ARM_TOP_L, SKIN_UPPER_ARM_TOP_R, SKIN_WAIST,
} from "../../shared/anim/skin-zones.ts";

// Clothing worn in the wardrobe slots, giving no armor. Each is drawn with its cut (shared/people/cuts.ts), made by
// assets/source/core/humans/garments/. What each covers is the skin its cut is over or under at every point in every
// pose of `bun tools/art/garment-fit.ts`, so the body is not drawn there. The weights are chosen, and so are the colours:
// a garment's `color` is what its regions are drawn in where neither its edition nor its dye gives one.

const TOP = [SKIN_CHEST, SKIN_ABDOMEN, SKIN_WAIST, SKIN_UPPER_ARM_TOP_L, SKIN_UPPER_ARM_TOP_R];
const LEGS = [SKIN_PELVIS, SKIN_THIGH_TOP_L, SKIN_THIGH_TOP_R];

export const GARMENTS: readonly Def[] = [
  { type: "item", class: "garment", id: "core:tee", stack: 1, weight: 0.2, label: "tee", color: 10,
    garment: { slot: "top", covers: TOP, dyes: true, cut: "tee" } },
  { type: "item", class: "garment", id: "core:loose_tee", stack: 1, weight: 0.25, label: "loose tee", color: 87,
    garment: { slot: "top", covers: TOP, dyes: true, cut: "tee_loose" } },
  { type: "item", class: "garment", id: "core:hoodie", stack: 1, weight: 0.6, label: "hoodie", color: 85,
    garment: { slot: "outer", covers: [...TOP, SKIN_COLLAR, SKIN_UPPER_ARM_LOW_L, SKIN_UPPER_ARM_LOW_R, SKIN_FOREARM_L, SKIN_FOREARM_R], dyes: true, cut: "hoodie" } },
  { type: "item", class: "garment", id: "core:jeans", stack: 1, weight: 0.6, label: "jeans", color: 29,
    garment: { slot: "bottom", covers: [...LEGS, SKIN_THIGH_LOW_L, SKIN_THIGH_LOW_R, SKIN_SHIN_L, SKIN_SHIN_R], dyes: true, cut: "jeans" } },
  { type: "item", class: "garment", id: "core:shorts", stack: 1, weight: 0.3, label: "shorts", color: 121,
    garment: { slot: "bottom", covers: LEGS, dyes: true, cut: "shorts" } },
  { type: "item", class: "garment", id: "core:trainers", stack: 1, weight: 0.5, label: "trainers", color: 10,
    garment: { slot: "shoes", covers: [SKIN_FOOT_L, SKIN_FOOT_R], dyes: true, cut: "trainers" } },
  // Open at the back, it hides no zone whole.
  { type: "item", class: "garment", id: "core:apron", stack: 1, weight: 0.3, label: "apron", color: 122,
    garment: { slot: "outer", covers: [], dyes: true, cut: "apron" } },
];
