import type { Def } from "../../shared/content/defs.ts";
import { crafting } from "../craft.ts";

// Gliders (planning/workstreams/glider.md). The frond glider stands where ARK's Parachute does, and is ours in everything
// but the place it takes (planning/quality/deviations.md): two bowed sticks with palm fronds lashed along them, a wing for
// each hand, opened in the air with Crouch (or Jump, out of the cuirass) from anywhere in the bag and flown down, steered,
// flared and dived, for as long as stamina lasts. ARK's Parachute (ark.wiki.gg, Parachute, infobox, 2026-11-21) is unlocked
// at level 22 for 6 engram points, made of 40 thatch, 20 fiber and 10 hide in 5 s, weighs 3, stacks to 20 and is spent when
// opened. Ours is a new survivor's: every number here is chosen.

export const GLIDERS: readonly Def[] = [
  // Thatch for the fronds, wood for the two spars and their handles, fibre for the lashings: what one or two palms and a
  // bush give to bare hands. It wears one use for each three seconds in the air, charged as it folds: some five minutes
  // aloft, twenty flights of a quarter of a minute. It is never spent in the air.
  { type: "item", class: "glider", id: "core:frond_glider", stack: 1, weight: 2, label: "frond glider", color: 17, glide: { grade: 1, uses: 100, seconds: 3 } },
  ...crafting("core:frond_glider", { needs: [{ item: "core:thatch", count: 30 }, { item: "core:fiber", count: 15 }, { item: "core:wood", count: 4 }], seconds: 5, xp: 4 }),
  // Free, and at the level the hatchet and the spear come at, so it costs a new survivor neither.
  { type: "engram", id: "core:engram-frond_glider", label: "Frond glider", level: 2, cost: 0, item: "core:frond_glider" },
];
