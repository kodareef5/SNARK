import type { Def } from "../../shared/content/defs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import { crafting } from "../craft.ts";

// Soul balls and the soul vault (planning/workstreams/soul-ball.md): ARK's Cryopod and Cryofridge, under names of ours.
// A ball keeps one tame, saddle and all, and is carried as any item is (server/balls.ts). The numbers are ARK: Survival
// Evolved's at 1x, read on ark.wiki.gg (Cryopod and Cryofridge, each page's infobox and text) on 2026-11-21, where the line
// does not say chosen; where ours differ, planning/quality/deviations.md says why ("Soul balls").

/** Real days as the game hours a spoil time is written in. */
const days = (n: number): number => (n * 86400 * TICK_RATE) / GAME_HOUR_TICKS;

/** The vault out and burning: one station (D515), alike but for the colour and the burning kind's holding a charge. */
function vaultPair(): Def[] {
  // "Health 20,000", "item slots 72" (120 is Ascended's), "decay time 40d". ARK's runs on electricity, which is not built:
  // ours burns gasoline as the fabricator does, a piece an hour as ARK's Electrical Generator burns it (chosen). It crafts
  // and cooks nothing. Its material and its box are chosen until it has art.
  const both = { type: "structure", class: "station", mesh: "shape", shape: "core:shape_soul_vault", half: [0.6, 1, 0.45], hp: 20000, material: "core:mat_metal", decayDays: 40, slots: 72, burns: [{ item: "core:gasoline", seconds: 3600 }], cooks: false, dry: true } as const;
  return [
    { ...both, id: "core:soul_vault", color: 9, lights: "core:soul_vault_lit" },
    { ...both, id: "core:soul_vault_lit", color: 13, lights: "core:soul_vault", lit: true, charges: true },
  ];
}

export const BALLS: readonly Def[] = [
  // The ball. "Weight 0.5", "stack size 1"; 10 crystal, 15 fiber, 5 hide, 2 metal ingot, 4 oil and 8 polymer in 5 s,
  // crafting xp 45.4 (our 181.6, D465's four times); level 51, 20 engram points. ARK makes it at a Tek Replicator, an
  // obelisk or a supply crate; ours is made at the fabricator, the last station built. A click is a throw's swing, and
  // does no harm: its `uses` is the one a thrown thing has, and never spent.
  { type: "item", class: "ball", id: "core:soul_ball", stack: 1, weight: 0.5, label: "soul ball", color: 9, ball: { full: "core:soul_ball_full" }, weapon: { kind: "thrown", uses: 1, mesh: "core:soul_ball", hold: "tool", wet: true } },
  ...crafting("core:soul_ball", { needs: [{ item: "core:crystal", count: 10 }, { item: "core:fiber", count: 15 }, { item: "core:hide", count: 5 }, { item: "core:ingot", count: 2 }, { item: "core:oil", count: 4 }, { item: "core:polymer", count: 8 }], seconds: 5, xp: 181.6, at: "core:fabricator" }),
  { type: "engram", id: "core:engram-soul_ball", label: "Soul ball", level: 51, cost: 20, item: "core:soul_ball" },
  // The same ball with a tame in it: never made, an empty one becomes it. Its spoil clock is its charge: "Inventory, tamed
  // creature, or Preserving Bin: 30 days"; "when charge hits zero ... the creature inside dies". It becomes an empty ball
  // again then, where ARK's dead pod must first be recharged. It does not leave its server until creatures can
  // (planning/architecture/transfers.md).
  { type: "item", class: "ball", id: "core:soul_ball_full", stack: 1, weight: 0.5, label: "soul ball, full", color: 13, ball: { empty: "core:soul_ball" }, charge: true, spoilHours: days(30), spoilsInto: "core:soul_ball", travels: false, weapon: { kind: "thrown", uses: 1, mesh: "core:soul_ball_full", hold: "tool", wet: true } },

  // The vault. Level 88, 60 engram points; 25 crystal, 60 polymer, 240 metal ingot and 45 silica pearls in 5 s, crafting
  // xp 292 (our 1,168); the item weighs 4. ARK's needs a fabricator and a refining forge to make: ours is made at the
  // fabricator. While it burns it holds every full ball in it at full charge ("recharges at the same rate it would drain
  // in inventory, so it never empties"); ours is full at once, and runs down from full once the vault is out.
  { type: "shape", id: "core:shape_soul_vault", role: "thing", boxes: [{ at: [0, 0, 0], half: [0.6, 1, 0.45] }] },
  ...vaultPair(),
  { type: "item", class: "structure", id: "core:piece_soul_vault", stack: 1, weight: 4, label: "soul vault", color: 9, places: ["core:soul_vault"] },
  ...crafting("core:piece_soul_vault", { needs: [{ item: "core:crystal", count: 25 }, { item: "core:polymer", count: 60 }, { item: "core:ingot", count: 240 }, { item: "core:silica_pearls", count: 45 }], seconds: 5, xp: 1168, at: "core:fabricator" }),
  { type: "engram", id: "core:engram-piece_soul_vault", label: "Soul vault", level: 88, cost: 60, item: "core:piece_soul_vault", requires: ["core:engram-piece_fabricator"] },

  // ARK's Cryo Cooldown and Cryo Sickness. "Cryo Cooldown (player): lasts 5 minutes. Releasing a creature during it applies
  // Cryo Sickness"; "Cryo Sickness (creature): lasts 5 minutes. Takes 10x damage. Knocked unconscious with a full torpor
  // bar. Cannot be podded again." The knock-out is given with the buff (server/balls.ts).
  { type: "buff", id: "core:ball_chill", label: "Ball chill", color: 13, seconds: 300, only: ["core:survivor"] },
  { type: "buff", id: "core:ball_sick", label: "Ball sick", color: 9, seconds: 300, taken: 10 },
];
